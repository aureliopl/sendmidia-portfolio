import { prisma } from '../db.js';

// Repositório de Contatos (sincronizados de uma conta via Baileys, ou adicionados à mão).
export const contactsRepo = {
  list(accountId, { search } = {}) {
    return prisma.contact.findMany({
      where: {
        accountId,
        ...(search
          ? { OR: [{ nome: { contains: search } }, { numero: { contains: search } }] }
          : {}),
      },
      orderBy: [{ nome: 'asc' }, { numero: 'asc' }],
    });
  },

  create(accountId, { nome, numero, verificado = false }) {
    return prisma.contact.create({
      data: { accountId, nome: nome || null, numero, verificado },
    });
  },

  get(id) {
    return prisma.contact.findUnique({ where: { id } });
  },

  remove(id) {
    return prisma.contact.delete({ where: { id } });
  },

  count(accountId) {
    return prisma.contact.count({ where: { accountId } });
  },

  // Upsert em lote a partir da sincronização do Baileys. Dedup por (accountId, numero)
  // garantido pelo @@unique do schema. Atualiza nome/verificado quando vierem preenchidos.
  // Processa em lotes para não criar uma transação gigante (o history sync inicial pode
  // trazer milhares de contatos) que travaria o SQLite por muito tempo.
  async bulkUpsert(accountId, contacts) {
    const seen = new Set();
    const ops = [];
    for (const c of contacts) {
      if (!c.numero || seen.has(c.numero)) continue;
      seen.add(c.numero);
      ops.push(
        prisma.contact.upsert({
          where: { accountId_numero: { accountId, numero: c.numero } },
          create: { accountId, numero: c.numero, nome: c.nome || null, verificado: Boolean(c.verificado) },
          // Só sobrescreve o nome se a sincronização trouxe um (não apaga nome existente).
          update: {
            ...(c.nome ? { nome: c.nome } : {}),
            ...(c.verificado ? { verificado: true } : {}),
          },
        }),
      );
    }
    const BATCH = 200;
    for (let i = 0; i < ops.length; i += BATCH) {
      await prisma.$transaction(ops.slice(i, i + BATCH));
    }
    return ops.length;
  },
};
