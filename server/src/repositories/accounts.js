import { prisma } from '../db.js';

// Repositório de Contas (números de WhatsApp). Estabelece o padrão de acesso a dados;
// as ações reais de conexão (Baileys) chegam no M3.
export const accountsRepo = {
  list({ status } = {}) {
    return prisma.account.findMany({
      where: status ? { status } : undefined,
      orderBy: { criadoEm: 'desc' },
    });
  },

  get(id) {
    return prisma.account.findUnique({ where: { id } });
  },

  create(data) {
    return prisma.account.create({ data });
  },

  update(id, data) {
    return prisma.account.update({ where: { id }, data });
  },

  setStatus(id, status) {
    return prisma.account.update({ where: { id }, data: { status } });
  },

  remove(id) {
    return prisma.account.delete({ where: { id } });
  },

  count() {
    return prisma.account.count();
  },
};
