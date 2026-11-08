import { prisma } from '../db.js';
import { addPlainDays, localDayKey, localDayLabel, localHourKey, localHourLabel } from '../timezone.js';

// Peso de uma reação (espelha o "Reagiu: 50 pts" do SendFlow). v1 do leadscoring só pontua
// reações; os demais sinais do print (recebeu/visualizou/reproduziu/mensagem) ficam para depois.
export const REACT_PESO = 50;

// Eventos de engajamento do Leadscoring (M9.3). Alimentado ao vivo pelo listener de reações
// do manager. A pontuação de um número é a soma dos pesos dos seus eventos.
export const leadEventsRepo = {
  // Registra uma reação capturada ao vivo. Faz o lookup do(s) grupo(s) local(is) pelo waGroupId
  // (qualquer conta da campanha). A unicidade vem do listener, que só repassa reações às NOSSAS
  // mensagens — logo só a conta que disparou pontua, sem duplicar entre contas.
  async recordReaction({ accountId, waGroupId, numero, jid, emoji, peso = REACT_PESO }) {
    if (!numero) return 0;
    const grupos = await prisma.group.findMany({ where: { waGroupId }, select: { id: true, campaignId: true, nome: true } });
    if (grupos.length === 0) return 0; // grupo não pertence a nenhuma campanha
    const data = grupos.map((g) => ({
      campaignId: g.campaignId,
      groupId: g.id,
      accountId: accountId || null,
      numero,
      jid: jid || null,
      tipo: 'react',
      peso,
      emoji: emoji || null,
      nomeGrupo: g.nome,
    }));
    await prisma.leadEvent.createMany({ data });
    return data.length;
  },

  // Ranking de pontos por número (soma dos pesos), ordenado desc e paginado. `busca` filtra por
  // número parcial. Devolve { itens: [{ numero, jid, pontos, eventos }], total } (total distinto).
  async ranking(campaignId, { busca, skip = 0, take = 25 } = {}) {
    const where = { campaignId };
    const buscaDigits = busca ? String(busca).replace(/\D/g, '') : '';
    if (buscaDigits) where.numero = { contains: buscaDigits };

    const grupos = await prisma.leadEvent.groupBy({
      by: ['numero'],
      where,
      _sum: { peso: true },
      _count: { _all: true },
      orderBy: { _sum: { peso: 'desc' } },
      skip,
      take,
    });

    const distintos = await prisma.leadEvent.findMany({ where, distinct: ['numero'], select: { numero: true } });
    const total = distintos.length;

    // jid representativo de cada número (para formatar PN x LID na UI)
    const numeros = grupos.map((g) => g.numero);
    const jids = numeros.length
      ? await prisma.leadEvent.findMany({ where: { campaignId, numero: { in: numeros } }, distinct: ['numero'], select: { numero: true, jid: true } })
      : [];
    const jidMap = new Map(jids.map((j) => [j.numero, j.jid]));

    const itens = grupos.map((g) => ({
      numero: g.numero,
      jid: jidMap.get(g.numero) || null,
      pontos: g._sum.peso || 0,
      eventos: g._count._all,
    }));
    return { itens, total };
  },

  // Lista completa (sem paginação) para exportar CSV — ordenada por pontos desc.
  async rankingCompleto(campaignId) {
    const grupos = await prisma.leadEvent.groupBy({
      by: ['numero'],
      where: { campaignId },
      _sum: { peso: true },
      _count: { _all: true },
      orderBy: { _sum: { peso: 'desc' } },
    });
    return grupos.map((g) => ({ numero: g.numero, pontos: g._sum.peso || 0, eventos: g._count._all }));
  },

  // Série de volume de eventos para o gráfico. unidade 'dia' → últimos `dias` dias; unidade
  // 'hora' → últimas 24 horas. Devolve { serie: [{ rotulo, valor }], total } no fuso do navegador.
  async volume(campaignId, { unidade = 'dia', dias = 7, timeZone = 'UTC', de, ate } = {}) {
    let inicio;
    const agora = ate ? new Date(ate) : new Date();
    if (unidade === 'hora') {
      inicio = de ? new Date(de) : new Date(agora.getTime() - 23 * 60 * 60 * 1000); // 24 buckets, incluindo a hora atual
    } else {
      inicio = de ? new Date(de) : new Date(agora.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    }

    const eventos = await prisma.leadEvent.findMany({
      where: { campaignId, criadoEm: { gte: inicio, lte: agora } },
      select: { criadoEm: true },
    });

    const keyDe = (d) => {
      return unidade === 'hora'
        ? localHourKey(d, timeZone)
        : localDayKey(d, timeZone);
    };
    const contagem = new Map();
    for (const e of eventos) {
      const k = keyDe(e.criadoEm);
      contagem.set(k, (contagem.get(k) || 0) + 1);
    }

    const serie = [];
    if (unidade === 'hora') {
      const cursor = new Date(inicio);
      for (let i = 0; i < 24; i++) {
        const k = localHourKey(cursor, timeZone);
        serie.push({ rotulo: localHourLabel(cursor, timeZone), valor: contagem.get(k) || 0 });
        cursor.setHours(cursor.getHours() + 1);
      }
    } else {
      let cursor = localDayKey(inicio, timeZone);
      const ultimo = localDayKey(agora, timeZone);
      while (cursor <= ultimo) {
        const meioDiaUtc = new Date(`${cursor}T12:00:00.000Z`);
        serie.push({ rotulo: localDayLabel(meioDiaUtc, 'UTC'), valor: contagem.get(cursor) || 0 });
        cursor = addPlainDays(cursor, 1);
      }
    }
    return { serie, total: eventos.length };
  },
};
