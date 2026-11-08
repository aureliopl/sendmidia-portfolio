import { prisma } from '../db.js';

// Rotas de teste do banco (M2). Ficam atrás do login (hook de auth protege /api/*).
// O endpoint de escrita é restrito a ambiente não-produção.
export default async function dbRoutes(app) {
  // Leitura: confirma conectividade e devolve as contagens por entidade.
  app.get('/api/db/health', async (_req, reply) => {
    try {
      const [accounts, campaigns, groups, messages, scheduledSends, leads] =
        await Promise.all([
          prisma.account.count(),
          prisma.campaign.count(),
          prisma.group.count(),
          prisma.message.count(),
          prisma.scheduledSend.count(),
          prisma.lead.count(),
        ]);
      return {
        ok: true,
        counts: { accounts, campaigns, groups, messages, scheduledSends, leads },
      };
    } catch (err) {
      app.log.error(err);
      reply.code(500);
      return { ok: false, error: 'db_unavailable' };
    }
  });

  // Escrita de teste (apenas dev): grava um Lead e devolve o total — prova o round-trip.
  app.post('/api/db/_test-write', async (_req, reply) => {
    if (process.env.NODE_ENV === 'production') {
      reply.code(404);
      return { ok: false, error: 'not_found' };
    }
    const lead = await prisma.lead.create({
      data: { numero: `test-${Date.now()}`, pontos: 1, eventos: '[]' },
    });
    const total = await prisma.lead.count();
    return { ok: true, lead, totalLeads: total };
  });
}
