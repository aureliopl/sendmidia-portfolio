import { randomUUID } from 'node:crypto';
import { campaignsRepo, messagesRepo, accountsRepo, scheduledSendsRepo, serializeMessage } from '../repositories/index.js';
import { prisma } from '../db.js';
import { enviarBlocos, selfJidFor, resolveProfile, distribuirGrupos, estimateSendDuration } from '../whatsapp/worker.js';

// Tamanhos de página permitidos na aba Ações (espelham o dropdown da UI). Default 10.
const SENDS_PAGE_SIZES = [10, 30, 50, 100];
function normalizeSendsPageSize(v) {
  const n = parseInt(v, 10);
  return SENDS_PAGE_SIZES.includes(n) ? n : 10;
}

function serializeSend(s) {
  let gruposAlvo = [];
  let resultado = null;
  try {
    gruposAlvo = s.gruposAlvo ? JSON.parse(s.gruposAlvo) : [];
  } catch {
    gruposAlvo = [];
  }
  try {
    resultado = s.resultado ? JSON.parse(s.resultado) : null;
  } catch {
    resultado = null;
  }
  if (Array.isArray(s.targets)) {
    resultado = s.targets
      .filter((t) => ['sent', 'failed', 'skipped'].includes(t.status))
      .map((t) => ({
        groupId: t.groupId,
        nome: t.nomeGrupo,
        ok: t.status === 'sent',
        error: t.status === 'sent' ? null : (t.erro || t.status),
        status: t.status,
        tentativa: t.tentativa,
        accountId: t.accountId,
        iniciadoEm: t.iniciadoEm,
        finalizadoEm: t.finalizadoEm,
      }));
  }
  return { ...s, gruposAlvo, resultado, message: s.message ? serializeMessage(s.message) : s.message };
}

export default async function sendsRoutes(app) {
  // Agendar/criar um disparo (M8.2). Os grupos são distribuídos entre as contas de
  // envio (anti-banimento): cria UM disparo por conta com seu lote de grupos.
  // Corpo: { messageId, contas: 'todas'|[ids], gruposAlvo: []|[ids], agendadoPara,
  //          perfilVelocidade, intervaloMin, intervaloMax }
  app.post('/api/campaigns/:id/sends', async (req, reply) => {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) {
      reply.code(404);
      return { ok: false, error: 'campanha_nao_encontrada' };
    }
    const { messageId, contas, gruposAlvo, agendadoPara, perfilVelocidade, intervaloMin, intervaloMax, marcarTodos } = req.body || {};
    const message = await messagesRepo.get(messageId);
    if (!message) {
      reply.code(400);
      return { ok: false, error: 'mensagem_invalida' };
    }
    const when = agendadoPara ? new Date(agendadoPara) : new Date();
    if (Number.isNaN(when.getTime())) {
      reply.code(400);
      return { ok: false, error: 'data_invalida' };
    }

    // Grupos-alvo: lista informada, ou todos os grupos da campanha.
    let groupIds = Array.isArray(gruposAlvo) ? gruposAlvo : [];
    if (groupIds.length === 0) {
      const all = await prisma.group.findMany({ where: { campaignId: req.params.id }, select: { id: true } });
      groupIds = all.map((g) => g.id);
    }
    if (groupIds.length === 0) {
      reply.code(400);
      return { ok: false, error: 'sem_grupos' };
    }

    // Contas de envio: 'todas' = contas associadas e conectadas; ou a lista informada
    // (também filtrada para conectadas).
    const links = await prisma.campaignAccount.findMany({
      where: { campaignId: req.params.id },
      include: { account: true },
    });
    let candidatas = links.map((l) => l.account).filter((a) => a.status === 'connected');
    if (Array.isArray(contas) && contas.length > 0) {
      const sel = new Set(contas);
      candidatas = candidatas.filter((a) => sel.has(a.id));
    }
    if (candidatas.length === 0) {
      reply.code(400);
      return { ok: false, error: 'sem_contas_conectadas' };
    }

    const { min, max } = resolveProfile(perfilVelocidade, intervaloMin, intervaloMax);
    const distribuicao = distribuirGrupos(groupIds, candidatas.map((a) => a.id));
    const estimate = estimateSendDuration({
      totalGrupos: groupIds.length,
      contas: distribuicao.size,
      perfilVelocidade,
      intervaloMin: min,
      intervaloMax: max,
    });

    // loteId comum a todos os disparos desta ação (a aba Ações agrupa por ele — M9.5).
    const loteId = randomUUID();
    const sends = [];
    for (const [accountId, lote] of distribuicao) {
      const send = await scheduledSendsRepo.create(req.params.id, {
        messageId,
        accountId,
        loteId,
        gruposAlvo: lote,
        agendadoPara: when,
        perfilVelocidade: perfilVelocidade || 'normal',
        intervaloMin: min,
        intervaloMax: max,
        status: 'scheduled',
        marcarTodos,
      });
      sends.push(serializeSend(send));
    }
    return { ok: true, sends, contas: candidatas.length, grupos: groupIds.length, estimate };
  });

  app.get('/api/campaigns/:id/sends', async (req, reply) => {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) {
      reply.code(404);
      return { ok: false, error: 'campanha_nao_encontrada' };
    }
    // Paginada por container (loteId), com filtro de status opcional. Carrega completo só a página.
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = normalizeSendsPageSize(req.query?.pageSize);
    const status = typeof req.query?.status === 'string' ? req.query.status : 'todos';
    const { sends, total } = await scheduledSendsRepo.listPagedContainers(req.params.id, { page, pageSize, status });
    return { ok: true, sends: sends.map(serializeSend), total, page, pageSize };
  });

  // Cancelar: só faz sentido enquanto ainda agendado (não iniciado) — remove da fila.
  app.post('/api/sends/:id/cancel', async (req, reply) => {
    const send = await scheduledSendsRepo.get(req.params.id);
    if (!send) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    if (send.status !== 'scheduled') {
      reply.code(409);
      return { ok: false, error: 'nao_cancelavel' };
    }
    await scheduledSendsRepo.remove(req.params.id);
    return { ok: true };
  });

  // Reprocessar: re-agenda para agora (o worker roda de novo).
  app.post('/api/sends/:id/reprocess', async (req, reply) => {
    const send = await scheduledSendsRepo.get(req.params.id);
    if (!send) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    await scheduledSendsRepo.create(send.campaignId, {
      messageId: send.messageId,
      accountId: send.accountId,
      gruposAlvo: (() => { try { return JSON.parse(send.gruposAlvo || '[]'); } catch { return []; } })(),
      agendadoPara: new Date(),
      perfilVelocidade: send.perfilVelocidade,
      intervaloMin: send.intervaloMin,
      intervaloMax: send.intervaloMax,
      status: 'scheduled',
      marcarTodos: send.marcarTodos,
    });
    return { ok: true };
  });

  // ── Ações em massa por container/lote (aba Ações — M9.5) ─────────────────────

  // Cancelar: remove os agendados ainda não iniciados da lista de ids.
  app.post('/api/sends/batch/cancel', async (req, reply) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const r = await scheduledSendsRepo.cancelMany(ids);
    return { ok: true, cancelados: r.count };
  });

  // Excluir do histórico: remove os registros indicados (qualquer status).
  app.post('/api/sends/batch/delete', async (req, reply) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const r = await scheduledSendsRepo.deleteMany(ids);
    return { ok: true, removidos: r.count };
  });

  // Reprocessar: re-agenda (como uma NOVA ação/lote) os disparos indicados. `somenteErros`
  // reprocessa só os que falharam (atalho "Reenviar ações com erro" do dropdown).
  app.post('/api/sends/batch/reprocess', async (req, reply) => {
    const { ids, somenteErros } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const sends = await scheduledSendsRepo.getMany(ids);
    const alvo = somenteErros ? sends.filter((s) => s.status === 'failed') : sends;
    const loteId = randomUUID();
    let reprocessados = 0;
    for (const s of alvo) {
      let lote = [];
      try { lote = JSON.parse(s.gruposAlvo || '[]'); } catch { lote = []; }
      await scheduledSendsRepo.create(s.campaignId, {
        messageId: s.messageId,
        accountId: s.accountId,
        loteId,
        gruposAlvo: lote,
        agendadoPara: new Date(),
        perfilVelocidade: s.perfilVelocidade,
        intervaloMin: s.intervaloMin,
        intervaloMax: s.intervaloMax,
        status: 'scheduled',
        marcarTodos: s.marcarTodos,
      });
      reprocessados += 1;
    }
    return { ok: true, reprocessados, loteId };
  });

  // Próximos agendamentos (Home — M8.7).
  app.get('/api/sends/upcoming', async () => {
    const sends = await scheduledSendsRepo.listUpcoming(8);
    return { ok: true, sends: sends.map(serializeSend) };
  });

  // Enviar teste para o PRÓPRIO número da conta (chat pessoal) — alvo seguro (M8).
  app.post('/api/campaigns/:id/messages/:msgId/test-send', async (req, reply) => {
    const { accountId } = req.body || {};
    const account = await accountsRepo.get(accountId);
    const message = await messagesRepo.get(req.params.msgId);
    if (!account || !message) {
      reply.code(400);
      return { ok: false, error: 'conta_ou_mensagem_invalida' };
    }
    if (account.status !== 'connected') {
      reply.code(409);
      return { ok: false, error: 'conta_desconectada' };
    }
    const jid = selfJidFor(account);
    if (!jid) {
      reply.code(409);
      return { ok: false, error: 'sem_numero' };
    }
    const r = await enviarBlocos(accountId, jid, message);
    if (!r.ok) {
      reply.code(502);
      return { ok: false, error: r.error };
    }
    return { ok: true, sample: r.sample };
  });
}
