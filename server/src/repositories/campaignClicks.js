import { prisma } from '../db.js';

// Cliques no link de convite geral da campanha (deep linking). Alimentam os indicadores
// Clicks e % de entrada (ver campaignsRepo.metricsSummary). `groupId` = grupo destino do
// redirect (null quando não havia grupo aberto e o clique caiu na página "sem vaga").
export const campaignClicksRepo = {
  record({ campaignId, groupId = null }) {
    return prisma.campaignClick.create({ data: { campaignId, groupId: groupId || null } });
  },
};
