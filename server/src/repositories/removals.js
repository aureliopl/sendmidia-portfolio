import { prisma } from '../db.js';

// Fila de remoção de participantes duplicados (M6.6). O worker consome devagar,
// com espaçamento anti-banimento. Estados: queued | done | failed | canceled.
export const removalsRepo = {
  // Enfileira em lote. itens: [{ campaignId, groupId, accountId, waGroupId, numero, nomeGrupo }]
  async enqueue(itens) {
    if (!itens || itens.length === 0) return { enfileirados: 0 };
    await prisma.participantRemoval.createMany({ data: itens });
    return { enfileirados: itens.length };
  },

  // Próxima remoção em fila de uma conta (worker processa 1 por vez, espaçado).
  nextForAccount(accountId) {
    return prisma.participantRemoval.findFirst({
      where: { accountId, status: 'queued' },
      orderBy: { criadoEm: 'asc' },
    });
  },

  // Contas distintas com algo na fila (para o worker iterar).
  async accountsWithQueued() {
    const rows = await prisma.participantRemoval.findMany({
      where: { status: 'queued' },
      distinct: ['accountId'],
      select: { accountId: true },
    });
    return rows.map((r) => r.accountId);
  },

  setStatus(id, status, extra = {}) {
    return prisma.participantRemoval.update({
      where: { id },
      data: { status, processadoEm: new Date(), ...extra },
    });
  },

  // Contagens por status numa campanha (progresso da operação).
  async progress(campaignId) {
    const rows = await prisma.participantRemoval.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const out = { queued: 0, done: 0, failed: 0, canceled: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    out.total = out.queued + out.done + out.failed + out.canceled;
    return out;
  },

  countQueued(campaignId) {
    return prisma.participantRemoval.count({ where: { campaignId, status: 'queued' } });
  },

  // Quantas remoções ainda restam na fila de uma conta (para o worker decidir se entra numa
  // pausa entre pacotes — só pausa se ainda houver trabalho pela frente).
  countQueuedForAccount(accountId) {
    return prisma.participantRemoval.count({ where: { accountId, status: 'queued' } });
  },

  // Cancela o que ainda não foi processado. O que já saiu não volta.
  cancelQueued(campaignId) {
    return prisma.participantRemoval.updateMany({
      where: { campaignId, status: 'queued' },
      data: { status: 'canceled' },
    });
  },

  // Circuit breaker: ao detectar a conta desconectada/deslogada no meio do lote, cancela o
  // restante daquela conta (não adianta — e é arriscado — seguir martelando uma conta que caiu).
  cancelQueuedForAccount(accountId, motivo = 'conta desconectada') {
    return prisma.participantRemoval.updateMany({
      where: { accountId, status: 'queued' },
      data: { status: 'canceled', erro: motivo, processadoEm: new Date() },
    });
  },

  // Limpa o histórico da campanha (para uma nova rodada limpa de remoção).
  clear(campaignId) {
    return prisma.participantRemoval.deleteMany({ where: { campaignId } });
  },
};
