import { prisma } from '../db.js';
import { groupsRepo } from './groups.js';
import { addPlainDays, localDayKey } from '../timezone.js';

// Eventos de entrada/saída de participantes nos grupos da campanha (M9.2 — aba Atividades).
// Alimentado ao vivo pelo listener do manager (group-participants.update). Read-only na UI.
export const groupActivitiesRepo = {
  // Registra um evento capturado ao vivo. Faz o lookup do(s) grupo(s) local(is) pela conta DONA
  // (waGroupId + accountId) — assim só a conta dona grava, sem duplicar quando várias contas
  // veem o mesmo evento. `participantes`: [{ numero, jid }]. `tipo`: 'join' | 'leave'.
  async recordEvent({ accountId, waGroupId, tipo, participantes }) {
    if (!Array.isArray(participantes) || participantes.length === 0) return 0;
    const grupos = await prisma.group.findMany({
      where: { waGroupId, accountId },
      select: { id: true, campaignId: true, nome: true },
    });
    if (grupos.length === 0) return 0; // grupo não pertence a nenhuma campanha desta conta
    const data = [];
    let validos = 0;
    for (const g of grupos) {
      for (const p of participantes) {
        if (!p.numero) continue;
        data.push({ campaignId: g.campaignId, groupId: g.id, accountId, numero: p.numero, jid: p.jid || null, tipo, nomeGrupo: g.nome });
      }
    }
    validos = participantes.filter((p) => p.numero).length;
    if (data.length === 0) return 0;
    await prisma.groupActivity.createMany({ data });
    // Atualiza a contagem ao vivo e aplica o auto-cheio (deep linking). join soma, leave subtrai
    // (sem ficar negativo). A contagem ao vivo é aproximada; a sincronização sob demanda corrige.
    const delta = tipo === 'join' ? validos : -validos;
    for (const g of grupos) {
      await prisma.group.update({
        where: { id: g.id },
        data: { participantes: { increment: delta } },
      }).catch(() => {});
      await prisma.group.updateMany({ where: { id: g.id, participantes: { lt: 0 } }, data: { participantes: 0 } });
      if (tipo === 'join') await groupsRepo.aplicarAutoCheio(g.id).catch(() => {});
    }
    return data.length;
  },

  // Lista os eventos da campanha com filtros (número parcial, grupo, evento, intervalo de datas).
  // Limitada às N mais recentes (a UI avisa quando trunca; o CSV usa a mesma lista).
  list(campaignId, { numero, groupId, tipo, inicio, fim, limite = 1000 } = {}) {
    const where = { campaignId };
    if (numero) where.numero = { contains: String(numero).replace(/\D/g, '') };
    if (groupId) where.groupId = groupId;
    if (tipo === 'join' || tipo === 'leave') where.tipo = tipo;
    if (inicio || fim) {
      where.criadoEm = {};
      if (inicio) where.criadoEm.gte = new Date(inicio);
      if (fim) where.criadoEm.lte = new Date(fim);
    }
    return prisma.groupActivity.findMany({ where, orderBy: { criadoEm: 'desc' }, take: limite });
  },

  // Série diária de entradas/saídas para o gráfico. `dias`: 7|14|21|28 (janela) ou 0 = todo o
  // período (desde o evento mais antigo). Devolve um ponto por dia (incluindo dias com zero),
  // mais os totais do período. `groupId` opcional restringe a um grupo.
  async daily(campaignId, { dias = 7, groupId, timeZone = 'UTC', de, ate } = {}) {
    const where = { campaignId };
    if (groupId) where.groupId = groupId;

    let inicio;
    const fim = ate ? new Date(ate) : new Date();
    if (dias && dias > 0) {
      inicio = de ? new Date(de) : new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000);
      where.criadoEm = { gte: inicio };
      if (ate) where.criadoEm.lte = fim;
    } else {
      // todo o período: começa no evento mais antigo (ou hoje, se não houver nenhum)
      const primeiro = await prisma.groupActivity.findFirst({ where, orderBy: { criadoEm: 'asc' }, select: { criadoEm: true } });
      inicio = primeiro ? new Date(primeiro.criadoEm) : new Date();
    }

    const eventos = await prisma.groupActivity.findMany({ where, select: { tipo: true, criadoEm: true } });
    const mapa = new Map(); // diaKey -> { entraram, sairam }
    let totalEntraram = 0;
    let totalSairam = 0;
    for (const e of eventos) {
      const k = localDayKey(e.criadoEm, timeZone);
      if (!mapa.has(k)) mapa.set(k, { entraram: 0, sairam: 0 });
      const bucket = mapa.get(k);
      if (e.tipo === 'join') { bucket.entraram += 1; totalEntraram += 1; }
      else if (e.tipo === 'leave') { bucket.sairam += 1; totalSairam += 1; }
    }

    // monta a série contínua (um ponto por dia entre inicio e hoje)
    const serie = [];
    let cursor = localDayKey(inicio, timeZone);
    const ultimo = localDayKey(fim, timeZone);
    while (cursor <= ultimo) {
      const k = cursor;
      const b = mapa.get(k) || { entraram: 0, sairam: 0 };
      serie.push({ dia: k, entraram: b.entraram, sairam: b.sairam });
      cursor = addPlainDays(cursor, 1);
    }

    return { serie, totalEntraram, totalSairam, dias: dias || serie.length };
  },
};
