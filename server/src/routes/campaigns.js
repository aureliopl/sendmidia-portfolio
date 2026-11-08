import { randomUUID } from 'node:crypto';
import { campaignsRepo, accountsRepo, groupsRepo, removalsRepo, groupEditsRepo, adminNumbersRepo, entryRequestsRepo, groupActivitiesRepo, leadEventsRepo, REACT_PESO, scheduledSendsRepo } from '../repositories/index.js';
import { prisma } from '../db.js';
import { fetchGroups, getInviteLink, revokeInviteLink, fetchParticipantsByAccount, fetchEntryRequests } from '../whatsapp/manager.js';
import { criarGrupoNaCampanha } from '../services/groupCreation.js';
import { clientTimeZone } from '../timezone.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Monta os nomes dos grupos a criar. Com numeração, anexa " #NN" (2 dígitos) a partir
// do número inicial — o "#NN" é o mesmo que a regra de duplicados (M6.6) usa para decidir
// em qual grupo o contato permanece (o de menor número).
function montarNomes(nomeBase, quantidade, numerar, numeroInicial) {
  const base = nomeBase.trim();
  if (!numerar) return Array.from({ length: quantidade }, () => base);
  const inicio = Math.max(1, Number(numeroInicial) || 1);
  return Array.from({ length: quantidade }, (_, i) => `${base} #${String(inicio + i).padStart(2, '0')}`);
}

// Valores válidos de expiração das mensagens temporárias (segundos): desativadas, 24h, 7d, 90d.
const EPHEMERAL_VALIDOS = [0, 86400, 604800, 7776000];

// Monta os campos COMUNS de edição em lote (M6.3) — iguais para todos os grupos —, só com o
// que o usuário escolheu alterar e já normalizados (nunca confiar no formato do cliente). O
// nome é tratado à parte (sanitizeNomeConfig), pois pode variar por grupo (numeração #NN).
function sanitizeEdits(raw = {}) {
  const edits = {};
  if (typeof raw.descricao === 'string') edits.descricao = raw.descricao; // string vazia = limpar a descrição
  if (typeof raw.soAdminEnvia === 'boolean') edits.soAdminEnvia = raw.soAdminEnvia;
  if (typeof raw.soAdminEditaInfo === 'boolean') edits.soAdminEditaInfo = raw.soAdminEditaInfo;
  if (typeof raw.aprovarEntrada === 'boolean') edits.aprovarEntrada = raw.aprovarEntrada;
  if (raw.mensagensTemporarias !== undefined && raw.mensagensTemporarias !== null) {
    const seg = Number(raw.mensagensTemporarias);
    if (EPHEMERAL_VALIDOS.includes(seg)) edits.mensagensTemporarias = seg;
  }
  if (Array.isArray(raw.promover)) {
    const numeros = [...new Set(raw.promover.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 6))];
    if (numeros.length > 0) {
      edits.promover = numeros;
      // opt-in consciente: adicionar ao grupo quem ainda não participa (risco de banimento).
      // Só faz sentido junto de uma promoção; default false (não adiciona).
      if (raw.adicionarSeFora === true) edits.adicionarSeFora = true;
    }
  }
  return edits;
}

// Config de renomeação em lote: nome base + numeração #NN opcional. A numeração resolve o
// problema de renomear vários grupos para o MESMO nome (sem ela ficariam idênticos); cada
// grupo recebe um #NN sequencial a partir do início, antes ou depois do nome.
function sanitizeNomeConfig(raw) {
  if (!raw || typeof raw.base !== 'string' || raw.base.trim().length === 0) return null;
  return {
    base: raw.base.trim(),
    numerar: Boolean(raw.numerar),
    numeroInicial: Math.max(1, Number(raw.numeroInicial) || 1),
    posicao: raw.posicao === 'antes' ? 'antes' : 'depois',
  };
}

// Monta o nome de um grupo com a numeração #NN (2 dígitos) antes ou depois do nome base.
function nomeComNumero(base, numero, posicao) {
  const nn = `#${String(numero).padStart(2, '0')}`;
  return posicao === 'antes' ? `${nn} ${base}` : `${base} ${nn}`;
}

// Rotas de Campanhas (M5): CRUD + arquivar + associação de contas + indicadores.
export default async function campaignsRoutes(app) {
  async function requireCampaign(id, reply) {
    const campaign = await campaignsRepo.get(id);
    if (!campaign) {
      reply.code(404);
      reply.send({ ok: false, error: 'not_found' });
      return null;
    }
    return campaign;
  }

  app.get('/api/campaigns', async (req) => {
    const { status } = req.query || {};
    const campaigns = await campaignsRepo.list(status ? { status } : {});
    return { ok: true, campaigns };
  });

  // Faixa de indicadores agregados (rota estática — declarada antes de /:id). ?periodo=dias.
  app.get('/api/campaigns/metrics', async (req) => {
    const dias = Number(req.query?.periodo);
    const metrics = await campaignsRepo.metricsSummary(Number.isFinite(dias) && dias > 0 ? dias : 7, {
      de: req.query?.de,
      ate: req.query?.ate,
    });
    return { ok: true, metrics };
  });

  app.post('/api/campaigns', async (req, reply) => {
    const { nome, tipo } = req.body || {};
    if (typeof nome !== 'string' || nome.trim().length === 0) {
      reply.code(400);
      return { ok: false, error: 'nome_obrigatorio' };
    }
    const campaign = await campaignsRepo.create({ nome: nome.trim(), tipo: tipo || null });
    return { ok: true, campaign };
  });

  app.get('/api/campaigns/:id', async (req, reply) => {
    const campaign = await requireCampaign(req.params.id, reply);
    if (!campaign) return;
    // Backfill lazy: campanhas criadas antes do deep linking ganham um inviteCode na 1ª abertura.
    if (!campaign.inviteCode) {
      campaign.inviteCode = await campaignsRepo.ensureInviteCode(campaign.id);
    }
    return { ok: true, campaign };
  });

  app.patch('/api/campaigns/:id', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { nome, tipo, velocidadePadrao, capacidadeGrupo, aberturaInteracaoHoras } = req.body || {};
    const data = {};
    if (typeof nome === 'string' && nome.trim().length > 0) data.nome = nome.trim();
    if (tipo !== undefined) data.tipo = tipo || null;
    const VEL = ['rapida', 'normal', 'lenta', 'ultralenta', 'custom'];
    if (velocidadePadrao && VEL.includes(velocidadePadrao)) data.velocidadePadrao = velocidadePadrao;
    if (aberturaInteracaoHoras !== undefined) {
      const h = Math.round(Number(aberturaInteracaoHoras));
      // 0 = nasce fechado; até 72h de abertura. Valores fora da faixa = erro.
      if (Number.isFinite(h) && h >= 0 && h <= 72) data.aberturaInteracaoHoras = h;
      else {
        reply.code(400);
        return { ok: false, error: 'abertura_invalida' };
      }
    }
    if (capacidadeGrupo !== undefined) {
      const cap = Math.round(Number(capacidadeGrupo));
      // limite do WhatsApp é 1024; aqui restringimos a 1000 (e mínimo de 50).
      if (Number.isFinite(cap) && cap >= 50 && cap <= 1000) data.capacidadeGrupo = cap;
      else {
        reply.code(400);
        return { ok: false, error: 'capacidade_invalida' };
      }
    }
    const campaign = await campaignsRepo.update(req.params.id, data);
    // Sincroniza a capacidade exibida nos grupos da campanha com o valor configurado.
    if (data.capacidadeGrupo !== undefined) {
      await prisma.group.updateMany({ where: { campaignId: req.params.id }, data: { capacidade: data.capacidadeGrupo } });
    }
    return { ok: true, campaign };
  });

  app.post('/api/campaigns/:id/archive', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    await campaignsRepo.archive(req.params.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/unarchive', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    await campaignsRepo.unarchive(req.params.id);
    return { ok: true };
  });

  app.delete('/api/campaigns/:id', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    await campaignsRepo.remove(req.params.id);
    return { ok: true };
  });

  // Contas: todas, com flag de associação, status e se é a criadora de grupos (usado em Contas
  // associadas e Diagnósticos).
  app.get('/api/campaigns/:id/accounts', async (req, reply) => {
    const campaign = await requireCampaign(req.params.id, reply);
    if (!campaign) return;
    const [accounts, links] = await Promise.all([
      accountsRepo.list(),
      prisma.campaignAccount.findMany({ where: { campaignId: req.params.id }, select: { accountId: true } }),
    ]);
    const associadas = new Set(links.map((l) => l.accountId));
    return {
      ok: true,
      accounts: accounts.map((a) => ({
        id: a.id,
        nome: a.nome,
        telefone: a.telefone,
        status: a.status,
        associada: associadas.has(a.id),
        criadora: a.id === campaign.contaCriadoraId,
      })),
    };
  });

  // Define (ou limpa) a conta criadora de grupos da campanha. Exclusiva: como é um campo único
  // na campanha, marcar uma desmarca a anterior automaticamente. `accountId: null` limpa.
  app.put('/api/campaigns/:id/conta-criadora', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { accountId } = req.body || {};
    if (accountId === null || accountId === undefined) {
      await campaignsRepo.setContaCriadora(req.params.id, null);
      return { ok: true, contaCriadoraId: null };
    }
    // só pode ser uma conta ASSOCIADA à campanha.
    const assoc = await prisma.campaignAccount.findUnique({
      where: { campaignId_accountId: { campaignId: req.params.id, accountId } },
      select: { accountId: true },
    });
    if (!assoc) {
      reply.code(400);
      return { ok: false, error: 'conta_nao_associada' };
    }
    await campaignsRepo.setContaCriadora(req.params.id, accountId);
    return { ok: true, contaCriadoraId: accountId };
  });

  // Regenera o código do link de convite geral (invalida o link antigo).
  app.post('/api/campaigns/:id/invite/regenerate', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const inviteCode = await campaignsRepo.regenerarInviteCode(req.params.id);
    return { ok: true, inviteCode };
  });

  app.post('/api/campaigns/:id/accounts/:accountId', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const account = await accountsRepo.get(req.params.accountId);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'conta_nao_encontrada' };
    }
    await campaignsRepo.associateAccount(req.params.id, req.params.accountId);
    return { ok: true };
  });

  app.delete('/api/campaigns/:id/accounts/:accountId', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    await campaignsRepo.dissociateAccount(req.params.id, req.params.accountId).catch(() => {});
    return { ok: true };
  });

  // ── Grupos da campanha (M6 pass 1: import + lista + status + links) ─────────

  // Lista os grupos persistidos na campanha. ?filtro=full|available|suspended.
  app.get('/api/campaigns/:id/groups', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const groups = await groupsRepo.list(req.params.id, { filtro: req.query?.filtro });
    return { ok: true, groups };
  });

  // Importa grupos existentes do WhatsApp (de uma conta) para a campanha. Read-only
  // no WhatsApp: busca os grupos ao vivo, filtra os selecionados e persiste localmente.
  app.post('/api/campaigns/:id/groups/import', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { accountId, waGroupIds } = req.body || {};
    if (!accountId || !Array.isArray(waGroupIds) || waGroupIds.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const account = await accountsRepo.get(accountId);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'conta_nao_encontrada' };
    }
    let live;
    try {
      live = await fetchGroups(accountId);
    } catch (err) {
      reply.code(409);
      if (err.code === 'not_leader') return { ok: false, error: 'not_leader' };
      return { ok: false, error: err.code === 'not_connected' ? 'not_connected' : 'sync_failed' };
    }
    const alvo = new Set(waGroupIds);
    const selecionados = live.filter((g) => alvo.has(g.waGroupId));
    const res = await groupsRepo.importMany(req.params.id, accountId, selecionados);
    return { ok: true, ...res };
  });

  // Marcar status em lote (cheio/aberto/etc.) — só estado local.
  app.patch('/api/campaigns/:id/groups/status', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { ids, status } = req.body || {};
    const VALIDOS = ['open', 'closed', 'full', 'suspended'];
    if (!Array.isArray(ids) || ids.length === 0 || !VALIDOS.includes(status)) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const res = await groupsRepo.setStatusMany(ids, status);
    return { ok: true, atualizados: res.count };
  });

  // Remover grupos da campanha (só estado local — não apaga o grupo no WhatsApp).
  app.post('/api/campaigns/:id/groups/remove', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const res = await groupsRepo.removeMany(ids);
    return { ok: true, removidos: res.count };
  });

  // Criar grupos (M6.2) — MUTAÇÃO REAL: cria N grupos no WhatsApp pela conta indicada,
  // aplica configurações, lê o link e persiste cada um na campanha. Cria em sequência com
  // um intervalo curto entre cada (evita martelar a API do WhatsApp). Máx. 20 por vez.
  app.post('/api/campaigns/:id/groups/create', async (req, reply) => {
    const campaign = await requireCampaign(req.params.id, reply);
    if (!campaign) return;
    const { accountId, nomeBase, quantidade, numerar, numeroInicial, aprovarEntrada } = req.body || {};
    const qtd = Number(quantidade);
    if (!accountId || typeof nomeBase !== 'string' || nomeBase.trim().length === 0 || !Number.isInteger(qtd) || qtd < 1 || qtd > 20) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const account = await accountsRepo.get(accountId);
    if (!account) {
      reply.code(404);
      return { ok: false, error: 'conta_nao_encontrada' };
    }
    const nomes = montarNomes(nomeBase, qtd, Boolean(numerar), numeroInicial);
    const grupos = [];
    const falhas = [];
    for (let i = 0; i < nomes.length; i++) {
      try {
        // a abertura/fechamento da interação segue a config da campanha (anti-banimento).
        const persistido = await criarGrupoNaCampanha(campaign, accountId, nomes[i], { aprovarEntrada: Boolean(aprovarEntrada) });
        grupos.push(persistido);
      } catch (err) {
        const error = err.code === 'not_leader'
          ? 'not_leader'
          : err.code === 'not_connected'
            ? 'not_connected'
            : 'falhou';
        falhas.push({ nome: nomes[i], error });
        // se a conta caiu, não adianta seguir tentando os demais
        if (err.code === 'not_connected' || err.code === 'not_leader') break;
      }
      if (i < nomes.length - 1) await sleep(1500);
    }
    return { ok: true, criados: grupos.length, total: nomes.length, grupos, falhas };
  });

  // Alterar grupos em lote (M6.3) — MUTAÇÃO REAL via FILA/WORKER: enfileira as edições
  // escolhidas (nome, descrição, permissões, promover admins) para cada grupo selecionado.
  // NÃO altera na hora — o worker processa devagar, espaçado (30–60s por conta, contas em
  // paralelo, anti-banimento). A UI acompanha o progresso via Socket.IO/polling.
  app.post('/api/campaigns/:id/groups/edit', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { ids, edits: rawEdits } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const edits = sanitizeEdits(rawEdits);
    const nomeConfig = sanitizeNomeConfig(req.body?.nomeConfig);
    if (Object.keys(edits).length === 0 && !nomeConfig) {
      reply.code(400);
      return { ok: false, error: 'nada_a_alterar' };
    }
    // não enfileira por cima de uma rodada ainda em andamento
    if ((await groupEditsRepo.countQueued(req.params.id)) > 0) {
      reply.code(409);
      return { ok: false, error: 'ja_em_andamento' };
    }
    await groupEditsRepo.clear(req.params.id); // começa uma rodada limpa (apaga histórico anterior)
    const groups = await prisma.group.findMany({ where: { id: { in: ids }, campaignId: req.params.id } });
    // Preserva a ordem em que os ids vieram (a numeração #NN segue essa ordem).
    const byId = new Map(groups.map((g) => [g.id, g]));
    const ordenados = ids.map((id) => byId.get(id)).filter(Boolean);
    const itens = [];
    let ignorados = 0;
    let n = 0; // contador da numeração (só grupos válidos, sem buracos no #NN)
    for (const g of ordenados) {
      if (!g.waGroupId) {
        ignorados += 1;
        continue;
      }
      // edits específicos deste grupo: os comuns + o nome calculado (quando há renomeação)
      const editsItem = { ...edits };
      if (nomeConfig) {
        editsItem.nome = nomeConfig.numerar
          ? nomeComNumero(nomeConfig.base, nomeConfig.numeroInicial + n, nomeConfig.posicao)
          : nomeConfig.base;
      }
      itens.push({
        campaignId: req.params.id,
        groupId: g.id,
        accountId: g.accountId,
        waGroupId: g.waGroupId,
        nomeGrupo: g.nome,
        edits: editsItem,
      });
      n += 1;
    }
    const r = await groupEditsRepo.enqueue(itens);
    const progress = await groupEditsRepo.progress(req.params.id);
    return { ok: true, ...r, ignorados, progress };
  });

  // Progresso da alteração em lote (polling de apoio ao Socket.IO).
  app.get('/api/campaigns/:id/group-edits/progress', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const progress = await groupEditsRepo.progress(req.params.id);
    return { ok: true, progress };
  });

  // Cancela as alterações ainda na fila (o que já foi alterado permanece).
  app.post('/api/campaigns/:id/group-edits/cancel', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const r = await groupEditsRepo.cancelQueued(req.params.id);
    return { ok: true, cancelados: r.count };
  });

  // Sincronizar participantes (M6.6) — READ-ONLY no WhatsApp: lê os participantes de cada
  // grupo (1 chamada por conta) e persiste em GroupParticipant, base para detectar duplicados.
  app.post('/api/campaigns/:id/groups/sync-participants', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const groups = await groupsRepo.list(req.params.id, {});
    // agrupa por conta para fazer uma única chamada Baileys por conta
    const porConta = new Map();
    for (const g of groups) {
      if (!g.waGroupId) continue;
      if (!porConta.has(g.accountId)) porConta.set(g.accountId, []);
      porConta.get(g.accountId).push(g);
    }
    let sincronizados = 0;
    let capturados = 0; // participantes com chave válida (número ou LID) persistidos
    let ignorados = 0; // participantes sem identificador utilizável
    const falhas = [];
    for (const [accountId, gs] of porConta) {
      let mapa;
      try {
        mapa = await fetchParticipantsByAccount(accountId);
      } catch (err) {
        falhas.push({
          accountId,
          error: err.code === 'not_leader' ? 'not_leader' : err.code === 'not_connected' ? 'not_connected' : 'falhou',
        });
        continue;
      }
      for (const g of gs) {
        const dados = mapa.get(g.waGroupId);
        if (!dados) {
          falhas.push({ id: g.id, nome: g.nome, error: 'grupo_nao_encontrado' });
          continue;
        }
        const n = await groupsRepo.syncParticipants(g.id, dados.participantes, dados.total);
        capturados += n;
        ignorados += dados.ignorados || 0;
        sincronizados += 1;
      }
    }
    return { ok: true, sincronizados, total: groups.length, capturados, ignorados, falhas };
  });

  // Lista os participantes duplicados da campanha (M6.6) — read-only, já marca qual grupo
  // seria mantido pela regra do menor "#NN".
  app.get('/api/campaigns/:id/groups/duplicates', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const protegidos = await adminNumbersRepo.protectedSet();
    const duplicados = await groupsRepo.findDuplicates(req.params.id, protegidos);
    return { ok: true, duplicados };
  });

  // Remover duplicados (M6.6) — MUTAÇÃO REAL: enfileira a expulsão de cada número dos
  // grupos "sair" (mantém no de menor #NN). NÃO remove na hora — o worker processa devagar,
  // espaçado (anti-banimento). A UI acompanha o progresso via Socket.IO/polling.
  app.post('/api/campaigns/:id/groups/remove-duplicates', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    // não enfileira por cima de uma remoção ainda em andamento
    if ((await removalsRepo.countQueued(req.params.id)) > 0) {
      reply.code(409);
      return { ok: false, error: 'ja_em_andamento' };
    }
    await removalsRepo.clear(req.params.id); // começa uma rodada limpa (apaga histórico anterior)
    const protegidos = await adminNumbersRepo.protectedSet();
    const dups = await groupsRepo.findDuplicates(req.params.id, protegidos);
    const itens = [];
    for (const d of dups) {
      for (const g of d.grupos) {
        if (g.manter || !g.waGroupId || !g.accountId) continue;
        itens.push({
          campaignId: req.params.id,
          groupId: g.groupId,
          accountId: g.accountId,
          waGroupId: g.waGroupId,
          numero: d.numero,
          jid: g.jid || null,
          nomeGrupo: g.nome,
        });
      }
    }
    const r = await removalsRepo.enqueue(itens);
    const progress = await removalsRepo.progress(req.params.id);
    return { ok: true, ...r, progress };
  });

  // Progresso da remoção de duplicados (polling de apoio ao Socket.IO).
  app.get('/api/campaigns/:id/removals/progress', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const progress = await removalsRepo.progress(req.params.id);
    return { ok: true, progress };
  });

  // Cancela o que ainda está na fila (o que já saiu não volta).
  app.post('/api/campaigns/:id/removals/cancel', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const r = await removalsRepo.cancelQueued(req.params.id);
    return { ok: true, cancelados: r.count };
  });

  // Redefinir link de convite (M6.5) — MUTAÇÃO REAL: revoga o link atual de cada grupo
  // selecionado e grava o novo. Invalida links já divulgados, por isso a UI confirma forte.
  // Processa em lote; coleta sucessos e falhas (conta desconectada / não-admin) por grupo.
  app.post('/api/campaigns/:id/groups/reset-links', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    const groups = await prisma.group.findMany({ where: { id: { in: ids }, campaignId: req.params.id } });
    let redefinidos = 0;
    const falhas = [];
    for (const g of groups) {
      if (!g.waGroupId) {
        falhas.push({ id: g.id, nome: g.nome, error: 'sem_grupo_whatsapp' });
        continue;
      }
      try {
        const link = await revokeInviteLink(g.accountId, g.waGroupId);
        await groupsRepo.setLink(g.id, link);
        redefinidos += 1;
      } catch (err) {
        falhas.push({
          id: g.id,
          nome: g.nome,
          error: err.code === 'not_leader' ? 'not_leader' : err.code === 'not_connected' ? 'not_connected' : 'falhou',
        });
      }
    }
    return { ok: true, redefinidos, total: groups.length, falhas };
  });

  // Atualizar links de convite: lê o código vigente de cada grupo (read-only) via a
  // conta admin e guarda. Falhas por grupo são ignoradas (segue os demais).
  app.post('/api/campaigns/:id/groups/refresh-links', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const groups = await groupsRepo.list(req.params.id, {});
    let atualizados = 0;
    for (const g of groups) {
      if (!g.waGroupId) continue;
      try {
        const link = await getInviteLink(g.accountId, g.waGroupId);
        if (link) {
          await groupsRepo.setLink(g.id, link);
          atualizados += 1;
        }
      } catch {
        // conta desconectada ou conta não-admin no grupo — pula
      }
    }
    return { ok: true, atualizados, total: groups.length };
  });

  // ── Solicitações de entrada (M9.1) ──────────────────────────────────────────

  // Sincroniza os pendentes ao vivo (read-only no WhatsApp): para cada grupo da campanha com
  // aprovação de admin, lê a lista de quem pediu para entrar e reflete em EntryRequest. Agrupa
  // por conta e pula as demais de uma conta que esteja desconectada (evita round-trips inúteis).
  app.post('/api/campaigns/:id/entry-requests/sync', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const groups = await groupsRepo.list(req.params.id, {});
    const porConta = new Map();
    for (const g of groups) {
      if (!g.waGroupId) continue;
      if (!porConta.has(g.accountId)) porConta.set(g.accountId, []);
      porConta.get(g.accountId).push(g);
    }
    let sincronizados = 0;
    let pendentes = 0;
    const falhas = [];
    for (const [accountId, gs] of porConta) {
      for (const g of gs) {
        try {
          const reqs = await fetchEntryRequests(accountId, g.waGroupId);
          const n = await entryRequestsRepo.syncForGroup(
            { campaignId: req.params.id, groupId: g.id, accountId, waGroupId: g.waGroupId, nomeGrupo: g.nome },
            reqs,
          );
          pendentes += n;
          sincronizados += 1;
        } catch (err) {
          if (err.code === 'not_leader') {
            falhas.push({ accountId, error: 'not_leader' });
            break;
          }
          if (err.code === 'not_connected') {
            falhas.push({ accountId, error: 'not_connected' });
            break; // conta desconectada: não tenta os demais grupos dela
          }
          falhas.push({ id: g.id, nome: g.nome, error: 'falhou' });
        }
      }
    }
    return { ok: true, sincronizados, total: groups.length, pendentes, falhas };
  });

  // Lista as solicitações por tipo (pendentes | processadas) + contadores + lote em andamento.
  // Em "pendentes", enriquece cada item com `jaEm`: nomes dos grupos DESTA campanha em que o
  // número já participa (reentrada — ajuda a decidir recusar quem já recebe o conteúdo).
  app.get('/api/campaigns/:id/entry-requests', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const tipo = req.query?.tipo === 'processadas' ? 'processed' : 'pending';
    const [itens, counts, loteAtivo] = await Promise.all([
      entryRequestsRepo.list(req.params.id, tipo),
      entryRequestsRepo.counts(req.params.id),
      entryRequestsRepo.loteAtivo(req.params.id),
    ]);
    let solicitacoes = itens;
    if (tipo === 'pending' && itens.length > 0) {
      const numeros = [...new Set(itens.map((i) => i.numero))];
      const parts = await prisma.groupParticipant.findMany({
        where: { numero: { in: numeros }, group: { campaignId: req.params.id } },
        select: { numero: true, group: { select: { nome: true } } },
      });
      const mapa = new Map();
      for (const p of parts) {
        if (!mapa.has(p.numero)) mapa.set(p.numero, []);
        mapa.get(p.numero).push(p.group.nome);
      }
      solicitacoes = itens.map((i) => ({ ...i, jaEm: mapa.get(i.numero) || [] }));
    }
    return { ok: true, solicitacoes, counts, loteAtivo };
  });

  // Aprovar/recusar em lote (MUTAÇÃO REAL via FILA/WORKER): marca os pendentes escolhidos como
  // `queued` com a ação; o worker processa devagar e em pacotes (anti-banimento). Não processa
  // por cima de uma rodada em andamento. A UI acompanha o progresso via Socket.IO/polling.
  app.post('/api/campaigns/:id/entry-requests/process', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { ids, acao } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || !['approve', 'reject'].includes(acao)) {
      reply.code(400);
      return { ok: false, error: 'parametros_invalidos' };
    }
    if ((await entryRequestsRepo.countQueued(req.params.id)) > 0) {
      reply.code(409);
      return { ok: false, error: 'ja_em_andamento' };
    }
    const loteId = randomUUID();
    const r = await entryRequestsRepo.enqueue(req.params.id, ids, acao, loteId);
    const progress = await entryRequestsRepo.progress(req.params.id, loteId);
    return { ok: true, ...r, progress };
  });

  // Progresso da rodada de moderação (polling de apoio ao Socket.IO).
  app.get('/api/campaigns/:id/entry-requests/progress', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const lote = req.query?.lote || (await entryRequestsRepo.loteAtivo(req.params.id));
    const progress = await entryRequestsRepo.progress(req.params.id, lote);
    return { ok: true, loteId: lote, progress };
  });

  // Cancela o que ainda está na fila (volta a "pendente"; o que já foi aprovado/recusado permanece).
  app.post('/api/campaigns/:id/entry-requests/cancel', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const r = await entryRequestsRepo.cancelQueued(req.params.id);
    return { ok: true, cancelados: r.count };
  });

  // ── Atividades (M9.2) — entradas/saídas de participantes capturadas ao vivo ──

  // Histórico de eventos com filtros: número (parcial), grupo, evento (join|leave), datas.
  app.get('/api/campaigns/:id/activities', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const { numero, groupId, evento, inicio, fim } = req.query || {};
    const tipo = evento === 'join' || evento === 'leave' ? evento : undefined;
    const itens = await groupActivitiesRepo.list(req.params.id, { numero, groupId, tipo, inicio, fim });
    return { ok: true, atividades: itens, limite: 1000 };
  });

  // Série diária de entradas/saídas para o gráfico (?dias=7|14|21|28|0 e ?groupId=).
  app.get('/api/campaigns/:id/activities/daily', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const dias = Number(req.query?.dias);
    const groupId = req.query?.groupId || undefined;
    const stats = await groupActivitiesRepo.daily(req.params.id, {
      dias: Number.isFinite(dias) ? dias : 7,
      groupId,
      timeZone: clientTimeZone(req),
      de: req.query?.de,
      ate: req.query?.ate,
    });
    return { ok: true, ...stats };
  });

  // ── Leadscoring (M9.3) — pontuação por número a partir de reações ────────────

  // Ranking de pontos por número (paginado). ?busca=&page=&perPage=.
  app.get('/api/campaigns/:id/leadscore', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const page = Math.max(1, Number(req.query?.page) || 1);
    const perPage = Math.min(100, Math.max(5, Number(req.query?.perPage) || 25));
    const { itens, total } = await leadEventsRepo.ranking(req.params.id, {
      busca: req.query?.busca,
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { ok: true, leads: itens, total, page, perPage, pesoReacao: REACT_PESO };
  });

  // Lista completa (sem paginação) para exportar CSV.
  app.get('/api/campaigns/:id/leadscore/export', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const leads = await leadEventsRepo.rankingCompleto(req.params.id);
    return { ok: true, leads };
  });

  // Volume de eventos para o gráfico. ?unidade=dia|hora (&dias= para 'dia').
  app.get('/api/campaigns/:id/leadscore/volume', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    const unidade = req.query?.unidade === 'hora' ? 'hora' : 'dia';
    const dias = Number(req.query?.dias);
    const stats = await leadEventsRepo.volume(req.params.id, {
      unidade,
      dias: Number.isFinite(dias) && dias > 0 ? dias : 7,
      timeZone: clientTimeZone(req),
      de: req.query?.de,
      ate: req.query?.ate,
    });
    return { ok: true, unidade, ...stats };
  });

  // ── Calendário (M9.4) — agendamentos de disparo no intervalo da grade ────────
  app.get('/api/campaigns/:id/calendar', async (req, reply) => {
    if (!(await requireCampaign(req.params.id, reply))) return;
    // A grade do mês manda `de`/`ate` (ISO) já calculados no fuso local do navegador.
    // Sem parâmetros, o fallback usa UTC para não herdar o fuso do VPS.
    const now = new Date();
    const de = req.query?.de ? new Date(req.query.de) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const ate = req.query?.ate ? new Date(req.query.ate) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const sends = await scheduledSendsRepo.listRange(req.params.id, de, ate);
    const eventos = sends.map((s) => {
      let grupos = 0;
      try { grupos = JSON.parse(s.gruposAlvo || '[]').length; } catch { grupos = 0; }
      return {
        id: s.id,
        agendadoPara: s.agendadoPara,
        status: s.status,
        grupos,
        conta: s.account?.nome || null,
        preview: (s.message?.conteudo || '').slice(0, 80),
      };
    });
    return { ok: true, eventos };
  });
}
