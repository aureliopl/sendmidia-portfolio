import { EXTERNAL_INTEGRATIONS_ENABLED } from './portfolio.js';
import { AUTHENTICATED_ROOM, allowedOrigin, socketAuthentication } from './security.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { Server as IOServer } from 'socket.io';
import authPlugin from './auth.js';
import dbRoutes from './routes/db.js';
import accountsRoutes from './routes/accounts.js';
import campaignsRoutes from './routes/campaigns.js';
import messagesRoutes from './routes/messages.js';
import sendsRoutes from './routes/sends.js';
import adminNumbersRoutes from './routes/adminNumbers.js';
import inviteRoutes from './routes/invite.js';
import { configureDatabase, disconnectPrisma } from './db.js';
import { attachIO, attachLogger as attachWhatsappLogger, shutdownSessions, setWhatsappControlEnabled, startSessionRestoreLoop, stopSessionRestoreLoop } from './whatsapp/manager.js';
import { attachWorkerIO, attachWorkerLogger, startWorker, stopWorker, recoverStuckSends } from './whatsapp/worker.js';
import { ensureUploadsDir, startUploadCleanup, stopUploadCleanup } from './uploads.js';
import { buildCommit, instanceId, isProd, safeError } from './runtime.js';
import { attachLeadershipLogger, getLeadershipStatus, startLeadership, stopLeadership } from './leadership.js';
import { attachAlertLogger } from './alerts/channels.js';
import { attachMonitorLogger, estadoDoMonitor, setMonitorEnabled } from './alerts/monitor.js';
import {
  attachAccountOwnershipLogger,
  getAccountOwnershipStatus,
  startAccountOwnershipHeartbeat,
  stopAccountOwnershipHeartbeat,
} from './accountOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// O .env vive na raiz do monorepo, mas o cwd do processo é o workspace `server/`
// (npm --workspace ajusta o cwd) — carregar pelo caminho absoluto evita depender disso.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const PORT = Number(process.env.PORT) || 3100;
// só garantem variáveis de ambiente durante o build, não na execução do processo.
// Servir os estáticos sempre que o build existir é mais robusto.
const clientDist = path.resolve(__dirname, '../../client/dist');
const hasClientBuild = existsSync(path.join(clientDist, 'index.html'));

const app = Fastify({
  logger: {
    base: { instanceId },
  },
});

const originalConsoleInfo = console.info.bind(console);
const sensitiveSessionLogPrefixes = ['Closing session:', 'Opening session:', 'Removing old closed session:'];
console.info = (...args) => {
  // A lib de criptografia do Baileys imprime objetos de sessão completos nesses eventos.
  // Eles podem conter material sensível; o logger estruturado do app já cobre o diagnóstico.
  const firstArg = args[0];
  if (typeof firstArg === 'string' && sensitiveSessionLogPrefixes.some((prefix) => firstArg.startsWith(prefix))) {
    return;
  }
  originalConsoleInfo(...args);
};

// Rede de segurança do processo. Neste desenho de processo único, um crash mata TODAS as contas
// e CONGELA todos os disparos em andamento. Em disparos longos o Baileys às vezes rejeita
// internamente, FORA de qualquer try/catch nosso — o caso clássico é `Timed Out` (408) no
// sendRetryRequest (um "retry receipt" do WhatsApp que expirou). Desde o Node 15 uma rejeição
// não tratada encerraria o processo. Aqui apenas registramos e seguimos vivos: esses timeouts do
// Baileys são recuperáveis e não podem derrubar o app inteiro no meio de um envio.
process.on('unhandledRejection', (reason) => {
  app.log.error({ error: safeError(reason) }, 'unhandledRejection capturada (processo mantido vivo)');
});
process.on('uncaughtException', (err) => {
  app.log.error({ error: safeError(err) }, 'uncaughtException capturada (processo mantido vivo)');
});

// Sem cache em toda resposta (decisão do projeto — uso pessoal).
// Também marca o site como invisível para buscadores: X-Robots-Tag cobre TODA resposta
// (inclusive não-HTML) e é a camada mais forte para manter o domínio fora dos índices.
app.addHook('onSend', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
});

// robots.txt bloqueando todos os robôs (segunda camada, para os que leem o arquivo).
app.get('/robots.txt', async (_req, reply) => {
  reply.type('text/plain');
  return 'User-agent: *\nDisallow: /\n';
});

// uptimeSec/pid expostos de propósito (sem dados sensíveis): permitem detectar de fora
// se o processo foi reciclado — em hospedagem LiteSpeed o app pode ser morto quando ocioso
// e reiniciado a cada requisição, o que pararia o worker in-process. Um pinger externo
// observando uptimeSec resetar (ou pid mudar) confirma se o processo realmente vive 24/7.
app.get('/api/health', async () => ({ ok: true, app: 'Sendmidia Portfolio', mode: 'portfolio' }));

const start = async () => {
  try {
    await configureDatabase();
    // O mesmo processo serve a SPA buildada (client/dist) sempre que ela existir —
    // em dev local normalmente não existe (usa-se o Vite na 5173); em produção, existe.
    // IMPORTANTE: nada de top-level await neste arquivo — alguns ambientes (ex.: o
    // que falha com ERR_REQUIRE_ASYNC_MODULE se houver await fora de uma função.
    await app.register(authPlugin);
    // Upload de mídia (Leva 2): 64MB por arquivo. Registrado antes das rotas que usam req.file().
    await app.register(fastifyMultipart, { limits: { fileSize: 64 * 1024 * 1024 } });
    await app.register(dbRoutes);
    await app.register(accountsRoutes);
    await app.register(campaignsRoutes);
    await app.register(messagesRoutes);
    await app.register(sendsRoutes);
    await app.register(adminNumbersRoutes);
    // Rota pública do link de convite geral (/i/:code) — registrada antes do SPA fallback.
    await app.register(inviteRoutes);

    if (hasClientBuild) {
      await app.register(fastifyStatic, { root: clientDist });
      app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
    }

    app.setErrorHandler((error, _request, reply) => {
      app.log.error({ error: safeError(error) }, 'Falha interna');
      const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
      reply.code(status).send({ ok: false, error: status === 500 ? 'internal_error' : 'invalid_request' });
    });
    await app.listen({ port: PORT, host: '127.0.0.1' });
    // Socket.IO compartilha o mesmo servidor HTTP do Fastify.
    const io = new IOServer(app.server, { cors: { origin: (origin, cb) => cb(null, allowedOrigin(origin)), credentials: true } });
    io.use(socketAuthentication(app));
    io.on('connection', (socket) => {
      socket.join(AUTHENTICATED_ROOM);
      const expiry = setTimeout(() => socket.disconnect(true), Math.max(1, socket.data.expiresAt - Date.now()));
      expiry.unref();
      socket.on('disconnect', () => clearTimeout(expiry));
      socket.emit('server:hello', { message: 'SendMídia conectado', ts: Date.now(), instanceId });
    });
    attachIO(io);
    attachWhatsappLogger(app.log);
    attachWorkerIO(io);
    attachWorkerLogger(app.log);
    attachLeadershipLogger(app.log);
    attachAccountOwnershipLogger(app.log);
    attachAlertLogger(app.log);
    attachMonitorLogger(app.log);
    app.log.info({ event: 'alertas', ...estadoDoMonitor() }, 'Monitor de alertas iniciado');
    app.log.info(`SendMídia ouvindo na porta ${PORT} (${isProd ? 'prod' : 'dev'})`);

    await startLeadership({
      onLeader: async () => {
        if (!EXTERNAL_INTEGRATIONS_ENABLED) { setWhatsappControlEnabled(false); setMonitorEnabled(false); return; }
        setWhatsappControlEnabled(true);
        // Só o líder alerta: com dois processos, o dono receberia cada incidente em duplicidade.
        setMonitorEnabled(true);
        startAccountOwnershipHeartbeat();
        startSessionRestoreLoop();
        startWorker();
        recoverStuckSends()
          .then((n) => n > 0 && app.log.info({ count: n }, 'Disparos órfãos reagendados ao assumir a liderança'))
          .catch((err) => app.log.error({ error: safeError(err) }, 'Falha ao recuperar disparos órfãos'));
      },
      onFollower: async () => {
        setWhatsappControlEnabled(false);
        setMonitorEnabled(false);
        stopSessionRestoreLoop();
        stopWorker();
        shutdownSessions({ silent: true });
        await stopAccountOwnershipHeartbeat();
      },
    });
    // Leva 2 (mídia): garante a pasta de uploads e inicia a autolimpeza (remove > 90 dias).
    ensureUploadsDir().catch(() => {});
    startUploadCleanup();

    // Encerramento limpo ao receber sinal de parada (restart do --watch, deploy, etc.).
    // Importante encerrar os sockets Baileys e o Socket.IO antes do app.close(): senão
    // as conexões WebSocket abertas seguram o processo e o shutdown trava. Um timeout
    // de segurança força a saída caso algo demore demais.
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, async () => {
        app.log.info(`Recebido ${signal}, encerrando...`);
        const force = setTimeout(() => process.exit(0), 3000);
        force.unref();
        try {
          // Primeiro silencia os alertas: o encerramento derruba as contas de propósito e não pode
          // gerar alerta falso a cada deploy.
          setMonitorEnabled(false);
          setWhatsappControlEnabled(false);
          stopSessionRestoreLoop();
          stopWorker();
          stopUploadCleanup();
          shutdownSessions({ silent: true });
          await stopAccountOwnershipHeartbeat();
          await stopLeadership();
          io.close();
          await app.close();
          await disconnectPrisma();
        } catch (err) {
          app.log.error({ error: safeError(err) });
        }
        clearTimeout(force);
        process.exit(0);
      });
    }
  } catch (err) {
    app.log.error({ error: safeError(err) });
    process.exit(1);
  }
};

start();
