import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { campaignsRepo, messagesRepo, serializeMessage } from '../repositories/index.js';
import { spin, countVariations } from '../utils/spintax.js';
import { fetchOgPreview } from '../utils/linkPreview.js';
import { uploadsDir, ensureUploadsDir, tipoValido, publicPath, readUpload, mimePorExt } from '../uploads.js';

// Tamanhos de página permitidos (espelham o dropdown da UI). Default 10.
const PAGE_SIZES = [10, 30, 50, 100];
function normalizePageSize(v) {
  const n = parseInt(v, 10);
  return PAGE_SIZES.includes(n) ? n : 10;
}

// Um bloco é aproveitável se tem texto, mídia, ou é uma enquete/contato preenchidos.
function blocoUtilizavel(b) {
  return Boolean(
    (b?.conteudo && b.conteudo.trim()) ||
    b?.midia ||
    (b?.tipo === 'enquete' && b.pergunta && Array.isArray(b.opcoes) && b.opcoes.length >= 2) ||
    (b?.tipo === 'contato' && b.nome && b.numero),
  );
}

export default async function messagesRoutes(app) {
  async function requireCampaign(id, reply) {
    const c = await campaignsRepo.get(id);
    if (!c) {
      reply.code(404);
      reply.send({ ok: false, error: 'not_found' });
      return null;
    }
    return c;
  }

  // Mensagens da campanha (paginadas: carrega só a página pedida, mais recentes primeiro).
  app.get('/api/campaigns/:id/messages', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = normalizePageSize(req.query?.pageSize);
    const [total, messages] = await Promise.all([
      messagesRepo.count(req.params.id),
      messagesRepo.listPaged(req.params.id, { skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { ok: true, messages: messages.map(serializeMessage), total, page, pageSize };
  });

  app.post('/api/campaigns/:id/messages', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { blocos, gruposAlvo } = req.body || {};
    if (!Array.isArray(blocos) || !blocos.some(blocoUtilizavel)) {
      reply.code(400);
      return { ok: false, error: 'blocos_obrigatorio' };
    }
    const message = await messagesRepo.create(req.params.id, { blocos, gruposAlvo });
    return { ok: true, message: serializeMessage(message) };
  });

  app.patch('/api/messages/:id', async (req, reply) => {
    const m = await messagesRepo.get(req.params.id);
    if (!m) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    const { blocos, gruposAlvo } = req.body || {};
    if (blocos !== undefined && (!Array.isArray(blocos) || !blocos.some(blocoUtilizavel))) {
      reply.code(400);
      return { ok: false, error: 'blocos_obrigatorio' };
    }
    const message = await messagesRepo.update(req.params.id, { blocos, gruposAlvo });
    return { ok: true, message: serializeMessage(message) };
  });

  app.delete('/api/messages/:id', async (req, reply) => {
    const m = await messagesRepo.get(req.params.id);
    if (!m) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    await messagesRepo.remove(req.params.id);
    return { ok: true };
  });

  app.post('/api/messages/:id/duplicate', async (req, reply) => {
    const message = await messagesRepo.duplicate(req.params.id);
    if (!message) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    return { ok: true, message: serializeMessage(message) };
  });

  // Spintax: gera uma variação de exemplo + total de variações possíveis (M7.2).
  app.post('/api/spintax/preview', async (req) => {
    const { text } = req.body || {};
    const t = typeof text === 'string' ? text : '';
    return { ok: true, sample: spin(t), variations: countVariations(t) };
  });

  // Preview de link (M7.3): busca a imagem/título OpenGraph do 1º link (read-only). Usa o mesmo
  // util do envio (fetchOgPreview), que inclui a checagem básica de host (anti-SSRF).
  app.post('/api/link-preview', async (req, reply) => {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      reply.code(400);
      return { ok: false, error: 'url_invalida' };
    }
    try {
      const preview = await fetchOgPreview(url);
      if (!preview) {
        reply.code(502);
        return { ok: false, error: 'preview_indisponivel' };
      }
      return { ok: true, preview };
    } catch {
      reply.code(502);
      return { ok: false, error: 'preview_indisponivel' };
    }
  });

  // ── Upload de mídia (Leva 2) ────────────────────────────────────────────────
  // Recebe um arquivo (multipart) e o guarda em DATA_DIR/uploads. ?tipo= define o tipo de mídia.
  // O arquivo é autoexcluído após 90 dias (autolimpeza no boot/24h). Devolve o caminho público.
  app.post('/api/uploads', async (req, reply) => {
    const tipo = req.query?.tipo;
    if (!tipoValido(tipo)) {
      reply.code(400);
      return { ok: false, error: 'tipo_invalido' };
    }
    let data;
    try {
      data = await req.file();
    } catch {
      reply.code(400);
      return { ok: false, error: 'arquivo_invalido' };
    }
    if (!data) {
      reply.code(400);
      return { ok: false, error: 'sem_arquivo' };
    }
    const nomeOriginal = data.filename || 'arquivo';
    const ext = (path.extname(nomeOriginal).slice(1) || 'bin').toLowerCase();
    const fileName = `${randomUUID()}.${ext}`;
    const destino = path.join(uploadsDir, fileName);
    await ensureUploadsDir();
    try {
      await pipeline(data.file, createWriteStream(destino));
    } catch {
      await unlink(destino).catch(() => {});
      reply.code(500);
      return { ok: false, error: 'falha_ao_salvar' };
    }
    // @fastify/multipart marca truncated quando estoura o limite de tamanho.
    if (data.file.truncated) {
      await unlink(destino).catch(() => {});
      reply.code(413);
      return { ok: false, error: 'arquivo_grande' };
    }
    return { ok: true, midia: publicPath(fileName), midiaTipo: tipo, midiaNome: nomeOriginal };
  });

  // Serve um arquivo enviado (protegido pelo login, pois está sob /api). Valida o nome contra
  // path traversal no util (readUpload).
  app.get('/api/uploads/:file', async (req, reply) => {
    const stream = readUpload(req.params.file);
    if (!stream) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    reply.header('Content-Type', mimePorExt(req.params.file));
    return reply.send(stream);
  });
}
