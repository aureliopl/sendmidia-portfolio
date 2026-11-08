import { prisma } from '../db.js';

export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Números administradores/protegidos (anti-spam). Globais. Ficam fora dos duplicados e
// da remoção. O conjunto efetivo inclui também os telefones das próprias contas.
export const adminNumbersRepo = {
  list() {
    return prisma.adminNumber.findMany({ orderBy: { criadoEm: 'desc' } });
  },

  async add(numero, nome) {
    const n = soDigitos(numero);
    if (!n) return null;
    return prisma.adminNumber.upsert({
      where: { numero: n },
      create: { numero: n, nome: nome?.trim() || null },
      update: nome?.trim() ? { nome: nome.trim() } : {},
    });
  },

  // Adiciona em lote (importação CSV). itens: [{ numero, nome }]. Normaliza e ignora vazios;
  // upsert por número (não duplica).
  async addMany(itens) {
    let adicionados = 0;
    let ignorados = 0;
    for (const it of itens || []) {
      const n = soDigitos(it?.numero);
      if (!n) {
        ignorados += 1;
        continue;
      }
      await prisma.adminNumber.upsert({
        where: { numero: n },
        create: { numero: n, nome: it.nome?.trim() || null },
        update: it.nome?.trim() ? { nome: it.nome.trim() } : {},
      });
      adicionados += 1;
    }
    return { adicionados, ignorados };
  },

  remove(id) {
    return prisma.adminNumber.delete({ where: { id } });
  },

  // Conjunto de números protegidos = cadastrados ∪ telefones das próprias contas conectadas.
  async protectedSet() {
    const [admins, contas] = await Promise.all([
      prisma.adminNumber.findMany({ select: { numero: true } }),
      prisma.account.findMany({ where: { telefone: { not: null } }, select: { telefone: true } }),
    ]);
    const set = new Set();
    for (const a of admins) set.add(a.numero);
    for (const c of contas) {
      const n = soDigitos(c.telefone);
      if (n) set.add(n);
    }
    return set;
  },
};
