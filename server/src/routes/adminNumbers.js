import { adminNumbersRepo, soDigitos } from '../repositories/adminNumbers.js';

// Números administradores / protegidos (anti-spam) — globais. Ficam fora dos participantes
// duplicados e da remoção. Os telefones das próprias contas já são protegidos no código.
export default async function adminNumbersRoutes(app) {
  app.get('/api/admin-numbers', async () => {
    const numbers = await adminNumbersRepo.list();
    return { ok: true, numbers };
  });

  app.post('/api/admin-numbers', async (req, reply) => {
    const { numero, nome } = req.body || {};
    if (!numero || soDigitos(numero).length === 0) {
      reply.code(400);
      return { ok: false, error: 'numero_invalido' };
    }
    const number = await adminNumbersRepo.add(numero, nome);
    return { ok: true, number };
  });

  // Importação em lote (Adicionar CSV). Body: { itens: [{ numero, nome }] }.
  app.post('/api/admin-numbers/bulk', async (req, reply) => {
    const { itens } = req.body || {};
    if (!Array.isArray(itens) || itens.length === 0) {
      reply.code(400);
      return { ok: false, error: 'lista_vazia' };
    }
    const r = await adminNumbersRepo.addMany(itens);
    return { ok: true, ...r };
  });

  app.delete('/api/admin-numbers/:id', async (req) => {
    await adminNumbersRepo.remove(req.params.id).catch(() => {});
    return { ok: true };
  });
}
