import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';

// Gera um código curto (base62, ~10 chars) para o link de convite geral (/i/<code>).
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function codigoAleatorio(tamanho = 10) {
  const bytes = randomBytes(tamanho);
  let out = '';
  for (let i = 0; i < tamanho; i += 1) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

// Repositório de Campanhas. Mesmo padrão de accountsRepo.
export const campaignsRepo = {
  list({ status } = {}) {
    return prisma.campaign.findMany({
      where: status ? { status } : undefined,
      orderBy: { criadoEm: 'desc' },
      include: { _count: { select: { groups: true, campaignAccounts: true } } },
    });
  },

  get(id) {
    return prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { groups: true, campaignAccounts: true, messages: true } } },
    });
  },

  // Gera um inviteCode único (loop até achar um livre). Usado na criação e no backfill.
  async gerarInviteCode() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const code = codigoAleatorio();
      const existe = await prisma.campaign.findUnique({ where: { inviteCode: code }, select: { id: true } });
      if (!existe) return code;
    }
  },

  // Garante que a campanha tem inviteCode (backfill lazy p/ campanhas criadas antes da feature).
  async ensureInviteCode(id) {
    const c = await prisma.campaign.findUnique({ where: { id }, select: { inviteCode: true } });
    if (c?.inviteCode) return c.inviteCode;
    const code = await this.gerarInviteCode();
    await prisma.campaign.update({ where: { id }, data: { inviteCode: code } });
    return code;
  },

  // Regenera o código (invalida o link antigo). Retorna o novo código.
  async regenerarInviteCode(id) {
    const code = await this.gerarInviteCode();
    await prisma.campaign.update({ where: { id }, data: { inviteCode: code } });
    return code;
  },

  // Campanha por código do link geral, com os grupos ABERTOS que têm link de convite
  // (candidatos do redirect). A filtragem por capacidade é feita por quem chama (usa
  // capacidadeGrupo da campanha vs participantes de cada grupo).
  getByInviteCode(code) {
    return prisma.campaign.findUnique({
      where: { inviteCode: code },
      include: {
        groups: {
          where: { status: 'open', linkConvite: { not: null } },
          select: { id: true, nome: true, linkConvite: true, participantes: true },
        },
      },
    });
  },

  setCapacidade(id, valor) {
    return prisma.campaign.update({ where: { id }, data: { capacidadeGrupo: valor } });
  },

  setContaCriadora(id, accountId) {
    return prisma.campaign.update({ where: { id }, data: { contaCriadoraId: accountId } });
  },

  async create(data) {
    const inviteCode = await this.gerarInviteCode();
    return prisma.campaign.create({ data: { ...data, inviteCode } });
  },

  update(id, data) {
    return prisma.campaign.update({ where: { id }, data });
  },

  archive(id) {
    return prisma.campaign.update({ where: { id }, data: { status: 'archived' } });
  },

  unarchive(id) {
    return prisma.campaign.update({ where: { id }, data: { status: 'active' } });
  },

  remove(id) {
    return prisma.campaign.delete({ where: { id } });
  },

  // Associa/desassocia uma conta à campanha (tabela N:N CampaignAccount).
  associateAccount(campaignId, accountId) {
    return prisma.campaignAccount.upsert({
      where: { campaignId_accountId: { campaignId, accountId } },
      create: { campaignId, accountId },
      update: {},
    });
  },

  async dissociateAccount(campaignId, accountId) {
    // Se a conta desassociada era a criadora de grupos, limpa a designação.
    await prisma.campaign.updateMany({
      where: { id: campaignId, contaCriadoraId: accountId },
      data: { contaCriadoraId: null },
    });
    return prisma.campaignAccount.delete({
      where: { campaignId_accountId: { campaignId, accountId } },
    });
  },

  count() {
    return prisma.campaign.count();
  },

  // Contas associadas a uma campanha (com os dados da conta).
  listAccounts(campaignId) {
    return prisma.campaignAccount.findMany({
      where: { campaignId },
      include: { account: true },
    });
  },

  // Indicadores agregados para a faixa da lista de campanhas (M9.6). Grupos/contas/participantes
  // são o estado atual. Entraram/Saíram refletem o PERÍODO (`dias`), das atividades capturadas
  // (GroupActivity/M9.2). Clicks e % de entrada dependem de deep linking (rastreio de cliques),
  // fora do escopo desta etapa, então não são calculados aqui. `porCampanha` alimenta os cards.
  async metricsSummary(dias = 7, { de, ate } = {}) {
    const inicio = de ? new Date(de) : new Date(Date.now() - (Math.max(1, dias) - 1) * 24 * 60 * 60 * 1000);
    const fim = ate ? new Date(ate) : new Date();

    const [campanhasAtivas, campanhasArquivadas, contas, grupos, gruposCheios, gruposDisponiveis, partAgg, atividades, cliquesAgg] =
      await Promise.all([
        prisma.campaign.count({ where: { status: 'active' } }),
        prisma.campaign.count({ where: { status: 'archived' } }),
        prisma.account.count(),
        prisma.group.count(),
        prisma.group.count({ where: { status: 'full' } }),
        prisma.group.count({ where: { status: 'open' } }),
        prisma.group.aggregate({ _sum: { participantes: true } }),
        prisma.groupActivity.groupBy({
          by: ['campaignId', 'tipo'],
          where: { criadoEm: { gte: inicio, lte: fim } },
          _count: { _all: true },
        }),
        prisma.campaignClick.groupBy({
          by: ['campaignId'],
          where: { criadoEm: { gte: inicio, lte: fim } },
          _count: { _all: true },
        }),
      ]);

    let entraram = 0;
    let sairam = 0;
    const porCampanha = {};
    const ensure = (id) => {
      if (!porCampanha[id]) porCampanha[id] = { entraram: 0, sairam: 0, clicks: 0 };
      return porCampanha[id];
    };
    for (const a of atividades) {
      const pc = ensure(a.campaignId);
      if (a.tipo === 'join') {
        entraram += a._count._all;
        pc.entraram += a._count._all;
      } else if (a.tipo === 'leave') {
        sairam += a._count._all;
        pc.sairam += a._count._all;
      }
    }
    let clicks = 0;
    for (const c of cliquesAgg) {
      clicks += c._count._all;
      ensure(c.campaignId).clicks += c._count._all;
    }
    // % de entrada = entraram / clicks no período (arredondado, 0 quando não há cliques).
    const pct = (e, cl) => (cl > 0 ? Math.round((e / cl) * 1000) / 10 : 0);
    for (const id of Object.keys(porCampanha)) {
      porCampanha[id].percentualEntrada = pct(porCampanha[id].entraram, porCampanha[id].clicks);
    }

    return {
      campanhasAtivas,
      campanhasArquivadas,
      contas,
      grupos,
      gruposCheios,
      gruposDisponiveis,
      participantes: partAgg._sum.participantes || 0,
      entraram,
      sairam,
      clicks,
      percentualEntrada: pct(entraram, clicks),
      dias,
      porCampanha,
    };
  },
};
