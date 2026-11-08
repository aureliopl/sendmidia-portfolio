import { accountsRepo, campaignsRepo } from '../repositories/index.js';
import { prisma } from '../db.js';
import { startSession, stopSession, fetchGroups } from '../whatsapp/manager.js';

// Rotas de Contas (M3): CRUD básico + controle da sessão WhatsApp (Baileys) por conta.
export default async function accountsRoutes(app) {
  app.get('/api/accounts', async (req) => {
    const { status } = req.query || {};
    const accounts = await accountsRepo.list(status ? { status } : {});
    return { ok: true, accounts };
  });

  app.get('/api/accounts/:id', async (req, reply) => {
    const account = await accountsRepo.get(req.params.id);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    return { ok: true, account };
  });

  app.post('/api/accounts', async (req, reply) => {
    const { nome, projeto } = req.body || {};
    if (typeof nome !== 'string' || nome.trim().length === 0) {
      reply.code(400);
      return { ok: false, error: 'nome_obrigatorio' };
    }
    const account = await accountsRepo.create({
      nome: nome.trim(),
      projeto: projeto || null,
    });
    return { ok: true, account };
  });

  app.patch('/api/accounts/:id', async (req, reply) => {
    const { nome, projeto } = req.body || {};
    const data = {};
    if (typeof nome === 'string' && nome.trim().length > 0) data.nome = nome.trim();
    if (projeto !== undefined) data.projeto = projeto || null;
    try {
      const account = await accountsRepo.update(req.params.id, data);
      return { ok: true, account };
    } catch {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
  });

  app.delete('/api/accounts/:id', async (req, reply) => {
    const account = await accountsRepo.get(req.params.id);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    try {
      await stopSession(req.params.id, { wipe: true });
    } catch (err) {
      reply.code(409);
      return {
        ok: false,
        error: err.code === 'not_leader'
          ? 'not_leader'
          : err.code === 'account_owned_by_other'
            ? 'account_owned_by_other'
            : 'stop_failed',
      };
    }
    await accountsRepo.remove(req.params.id);
    return { ok: true };
  });

  // Iniciar Sessão: abre (ou reabre) a conexão Baileys; o QR (se necessário) chega
  // via Socket.IO no evento `account:qr`.
  app.post('/api/accounts/:id/session/start', async (req, reply) => {
    const account = await accountsRepo.get(req.params.id);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    try {
      // Ação explícita do dono: zera a espera acumulada do backoff e tenta conectar agora.
      await startSession(req.params.id, { manual: true });
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return {
        ok: false,
        error: err.code === 'not_leader'
          ? 'not_leader'
          : err.code === 'account_owned_by_other'
            ? 'account_owned_by_other'
            : 'start_failed',
      };
    }
  });

  // Desconectar: encerra a sessão em memória mas mantém as credenciais salvas
  // (reconecta sem precisar de novo QR).
  app.post('/api/accounts/:id/session/disconnect', async (req, reply) => {
    const account = await accountsRepo.get(req.params.id);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    try {
      await stopSession(req.params.id, { wipe: false });
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return {
        ok: false,
        error: err.code === 'not_leader'
          ? 'not_leader'
          : err.code === 'account_owned_by_other'
            ? 'account_owned_by_other'
            : 'stop_failed',
      };
    }
  });

  // Finalizar Sessão: apaga as credenciais salvas — a conta volta a "Sem Sessão"
  // e precisará de um novo QR Code para reconectar.
  app.post('/api/accounts/:id/session/end', async (req, reply) => {
    const account = await accountsRepo.get(req.params.id);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    try {
      await stopSession(req.params.id, { wipe: true });
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return {
        ok: false,
        error: err.code === 'not_leader'
          ? 'not_leader'
          : err.code === 'account_owned_by_other'
            ? 'account_owned_by_other'
            : 'stop_failed',
      };
    }
  });

  // ── Detalhe da conta (M4) ─────────────────────────────────────────────────

  // Helper: garante que a conta existe; responde 404 e retorna null caso contrário.
  async function requireAccount(id, reply) {
    const account = await accountsRepo.get(id);
    if (!account) {
      reply.code(404);
      reply.send({ ok: false, error: 'not_found' });
      return null;
    }
    return account;
  }

  // Grupos (leitura ao vivo via Baileys; requer sessão conectada)
  app.get('/api/accounts/:id/groups', async (req, reply) => {
    if (!(await requireAccount(req.params.id, reply))) return;
    try {
      const groups = await fetchGroups(req.params.id);
      return { ok: true, groups };
    } catch (err) {
      reply.code(409);
      if (err.code === 'not_leader') return { ok: false, error: 'not_leader' };
      if (err.code === 'account_owned_by_other') return { ok: false, error: 'account_owned_by_other' };
      return { ok: false, error: err.code === 'not_connected' ? 'not_connected' : 'sync_failed' };
    }
  });

  // Campanhas: lista todas com flag de associação a esta conta
  app.get('/api/accounts/:id/campaigns', async (req, reply) => {
    if (!(await requireAccount(req.params.id, reply))) return;
    const [campaigns, links] = await Promise.all([
      campaignsRepo.list(),
      prisma.campaignAccount.findMany({ where: { accountId: req.params.id }, select: { campaignId: true } }),
    ]);
    const associadas = new Set(links.map((l) => l.campaignId));
    return {
      ok: true,
      campaigns: campaigns.map((c) => ({ id: c.id, nome: c.nome, status: c.status, associada: associadas.has(c.id) })),
    };
  });

  app.post('/api/accounts/:id/campaigns/:campaignId', async (req, reply) => {
    if (!(await requireAccount(req.params.id, reply))) return;
    const campaign = await campaignsRepo.get(req.params.campaignId);
    if (!campaign) {
      reply.code(404);
      return { ok: false, error: 'campanha_nao_encontrada' };
    }
    await campaignsRepo.associateAccount(req.params.campaignId, req.params.id);
    return { ok: true };
  });

  app.delete('/api/accounts/:id/campaigns/:campaignId', async (req, reply) => {
    if (!(await requireAccount(req.params.id, reply))) return;
    await campaignsRepo.dissociateAccount(req.params.campaignId, req.params.id).catch(() => {});
    return { ok: true };
  });
}
