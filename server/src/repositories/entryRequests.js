import { prisma } from '../db.js';

// Solicitações de entrada em grupos (M9.1). Um registro por (grupo, número) que pediu para
// entrar. Estados: pending (aguardando moderação) | queued (na fila p/ aprovar/recusar) |
// approved | rejected | failed | canceled. A aprovação/recusa real é feita DEVAGAR pelo
// worker (pacing anti-banimento: aprovar = +1 membro no grupo), 1 por conta de cada vez.
export const entryRequestsRepo = {
  // Sincroniza os pendentes de UM grupo com a lista ao vivo do WhatsApp (read-only no WA).
  // `requests`: [{ numero, jid }] vindos do Baileys. Reflete a realidade atual:
  //  - cria os pendentes novos;
  //  - remove os `pending` que sumiram da lista (já resolvidos por fora);
  //  - NÃO mexe nos que já estão na fila ou processados (queued/approved/rejected/failed).
  async syncForGroup(grupo, requests) {
    const { campaignId, groupId, accountId, waGroupId, nomeGrupo } = grupo;
    // números já tratados (não-pending) deste grupo: não recriar como pending.
    const tratados = await prisma.entryRequest.findMany({
      where: { groupId, status: { not: 'pending' } },
      select: { numero: true },
    });
    const setTratados = new Set(tratados.map((t) => t.numero));
    const novos = requests.filter((r) => r.numero && !setTratados.has(r.numero));
    await prisma.$transaction([
      prisma.entryRequest.deleteMany({ where: { groupId, status: 'pending' } }),
      prisma.entryRequest.createMany({
        data: novos.map((r) => ({
          campaignId,
          groupId,
          accountId: accountId || null,
          waGroupId: waGroupId || null,
          numero: r.numero,
          jid: r.jid || null,
          nomeGrupo: nomeGrupo || null,
          status: 'pending',
        })),
      }),
    ]);
    return novos.length;
  },

  // Lista solicitações de uma campanha por tipo: 'pending' (a moderar) ou 'processed'
  // (histórico: aprovadas/recusadas/falhas). `queued` (em processamento) não aparece em
  // nenhuma das duas listas — fica só na barra de progresso da operação.
  list(campaignId, tipo) {
    const status = tipo === 'processed'
      ? { in: ['approved', 'rejected', 'failed'] }
      : 'pending';
    return prisma.entryRequest.findMany({
      where: { campaignId, status },
      orderBy: tipo === 'processed' ? { processadoEm: 'desc' } : { criadoEm: 'desc' },
    });
  },

  // Contagens por status (para os contadores das sub-abas).
  async counts(campaignId) {
    const rows = await prisma.entryRequest.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const out = { pending: 0, queued: 0, approved: 0, rejected: 0, failed: 0, canceled: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  },

  // Enfileira uma rodada de moderação: marca os pendentes escolhidos como `queued` com a ação
  // (approve|reject) e um loteId comum (p/ a barra de progresso seguir só esta rodada). Só pega
  // os que ainda estão `pending` (evita reprocessar o que já saiu/está na fila). Devolve o loteId.
  async enqueue(campaignId, ids, acao, loteId) {
    const r = await prisma.entryRequest.updateMany({
      where: { id: { in: ids }, campaignId, status: 'pending' },
      data: { status: 'queued', acao, loteId, erro: null },
    });
    return { enfileirados: r.count, loteId };
  },

  // Próxima solicitação na fila de uma conta (worker processa 1 por vez, espaçado).
  nextForAccount(accountId) {
    return prisma.entryRequest.findFirst({
      where: { accountId, status: 'queued' },
      orderBy: { criadoEm: 'asc' },
    });
  },

  // Contas distintas com algo na fila (para o worker iterar). Ignora itens sem conta.
  async accountsWithQueued() {
    const rows = await prisma.entryRequest.findMany({
      where: { status: 'queued', accountId: { not: null } },
      distinct: ['accountId'],
      select: { accountId: true },
    });
    return rows.map((r) => r.accountId);
  },

  setStatus(id, status, extra = {}) {
    return prisma.entryRequest.update({
      where: { id },
      data: { status, processadoEm: new Date(), ...extra },
    });
  },

  // Progresso de uma rodada (loteId) — contagens por status. Sem loteId, conta a campanha toda.
  async progress(campaignId, loteId) {
    const where = { campaignId };
    if (loteId) where.loteId = loteId;
    const rows = await prisma.entryRequest.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const out = { pending: 0, queued: 0, approved: 0, rejected: 0, failed: 0, canceled: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    out.total = out.queued + out.approved + out.rejected + out.failed + out.canceled;
    return out;
  },

  countQueued(campaignId) {
    return prisma.entryRequest.count({ where: { campaignId, status: 'queued' } });
  },

  // Quantos ainda restam na fila de uma conta (worker decide se entra na pausa entre pacotes).
  countQueuedForAccount(accountId) {
    return prisma.entryRequest.count({ where: { accountId, status: 'queued' } });
  },

  // loteId em andamento de uma campanha (o front retoma o progresso ao reabrir a aba).
  async loteAtivo(campaignId) {
    const row = await prisma.entryRequest.findFirst({
      where: { campaignId, status: 'queued' },
      orderBy: { criadoEm: 'desc' },
      select: { loteId: true },
    });
    return row?.loteId || null;
  },

  // Cancela o que ainda está na fila: volta a `pending` (a solicitação segue existindo no
  // WhatsApp; só não será processada agora). O que já foi aprovado/recusado permanece.
  cancelQueued(campaignId) {
    return prisma.entryRequest.updateMany({
      where: { campaignId, status: 'queued' },
      data: { status: 'pending', acao: null, loteId: null },
    });
  },

  // Circuit breaker: a conta caiu no meio do lote. Devolve o restante dela para `pending`
  // (em vez de seguir martelando uma conta que o WhatsApp pode estar observando).
  cancelQueuedForAccount(accountId) {
    return prisma.entryRequest.updateMany({
      where: { accountId, status: 'queued' },
      data: { status: 'pending', acao: null, loteId: null },
    });
  },
};
