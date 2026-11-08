import { prisma, queueDbWrite } from '../db.js';
import { instanceId } from '../runtime.js';

// Repositório da fila de disparos (ScheduledSend). gruposAlvo em JSON texto.
export const FINAL_TARGET_STATUSES = ['sent', 'failed', 'skipped'];

// Status do container (lote) a partir dos status dos disparos que o compõem. Mesma regra
// usada na UI (aba Ações) para os filtros por status.
function containerStatus(sends = []) {
  const st = sends.map((s) => s.status);
  if (st.includes('processing')) return 'processing';
  if (st.includes('scheduled')) return 'scheduled';
  if (st.every((x) => x === 'sent')) return 'sent';
  if (st.every((x) => x === 'failed')) return 'failed';
  return st.includes('sent') ? 'sent' : 'failed';
}

function parseGruposAlvo(send) {
  try {
    const ids = send?.gruposAlvo ? JSON.parse(send.gruposAlvo) : [];
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function resultadoFromTargets(targets = []) {
  return targets
    .filter((t) => FINAL_TARGET_STATUSES.includes(t.status))
    .map((t) => ({
      groupId: t.groupId,
      nome: t.nomeGrupo,
      ok: t.status === 'sent',
      error: t.status === 'sent' ? null : (t.erro || t.status),
    }));
}

async function buildTargetRows(tx, send, groupIds) {
  const groups = await tx.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, waGroupId: true, nome: true },
  });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const now = new Date();
  return groupIds.map((groupId) => {
    const g = byId.get(groupId);
    return {
      scheduledSendId: send.id,
      groupId,
      accountId: send.accountId,
      waGroupId: g?.waGroupId || null,
      nomeGrupo: g?.nome || 'Grupo removido',
      status: g?.waGroupId ? 'pending' : 'skipped',
      erro: g?.waGroupId ? null : 'sem_wa_group_id',
      finalizadoEm: g?.waGroupId ? null : now,
      atualizadoEm: now,
    };
  });
}

export const scheduledSendsRepo = {
  create(campaignId, { messageId, accountId, loteId, gruposAlvo, agendadoPara, perfilVelocidade, intervaloMin, intervaloMax, status, marcarTodos }) {
    const groupIds = Array.isArray(gruposAlvo) ? gruposAlvo.filter(Boolean) : [];
    return queueDbWrite(() => prisma.$transaction(async (tx) => {
      const send = await tx.scheduledSend.create({
        data: {
          campaignId,
          messageId,
          accountId,
          loteId: loteId || null,
          gruposAlvo: JSON.stringify(groupIds),
          agendadoPara,
          perfilVelocidade: perfilVelocidade || 'normal',
          intervaloMin: intervaloMin ?? 140,
          intervaloMax: intervaloMax ?? 460,
          status: status || 'scheduled',
          marcarTodos: Boolean(marcarTodos),
        },
      });
      const rows = await buildTargetRows(tx, send, groupIds);
      if (rows.length > 0) {
        await tx.scheduledSendTarget.createMany({ data: rows });
      }
      return tx.scheduledSend.findUnique({
        where: { id: send.id },
        include: { targets: true },
      });
    }));
  },

  list(campaignId) {
    return prisma.scheduledSend.findMany({
      where: { campaignId },
      orderBy: { criadoEm: 'desc' },
      include: {
        account: { select: { nome: true, telefone: true } },
        message: { select: { conteudo: true, blocos: true, midia: true, midiaTipo: true, midiaNome: true, usarPreviewLink: true } },
        targets: { orderBy: { criadoEm: 'asc' } },
      },
    });
  },

  // Página da aba Ações, agrupada por "container" (loteId). Para aliviar o carregamento,
  // primeiro lê só campos leves para agrupar/ordenar/filtrar por status; depois busca os dados
  // completos (mensagem + targets) apenas dos disparos da página atual.
  async listPagedContainers(campaignId, { page = 1, pageSize = 10, status = 'todos' } = {}) {
    const leves = await prisma.scheduledSend.findMany({
      where: { campaignId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, loteId: true, messageId: true, agendadoPara: true, status: true },
    });
    // Agrupa por container preservando a ordem (mais recente primeiro).
    const grupos = new Map();
    const ordem = [];
    for (const s of leves) {
      const chave = s.loteId || `${s.messageId}|${s.agendadoPara ? s.agendadoPara.toISOString() : 'null'}`;
      if (!grupos.has(chave)) { grupos.set(chave, []); ordem.push(chave); }
      grupos.get(chave).push(s);
    }
    // Filtra por status derivado do container (mesma regra da UI).
    let chaves = ordem;
    if (status && status !== 'todos') chaves = ordem.filter((k) => containerStatus(grupos.get(k)) === status);
    const total = chaves.length;
    const pageKeys = chaves.slice((page - 1) * pageSize, page * pageSize);
    const ids = pageKeys.flatMap((k) => grupos.get(k).map((s) => s.id));
    if (ids.length === 0) return { sends: [], total };
    const sends = await prisma.scheduledSend.findMany({
      where: { id: { in: ids } },
      orderBy: { criadoEm: 'desc' },
      include: {
        account: { select: { nome: true, telefone: true } },
        message: { select: { conteudo: true, blocos: true, midia: true, midiaTipo: true, midiaNome: true, usarPreviewLink: true } },
        targets: { orderBy: { criadoEm: 'asc' } },
      },
    });
    return { sends, total };
  },

  getMany(ids) {
    return prisma.scheduledSend.findMany({ where: { id: { in: ids } } });
  },

  // Ações em massa da aba Ações (M9.5). Operam sobre uma lista de ids (um container/lote).
  cancelMany(ids) {
    // só remove o que ainda está agendado (não mexe no que já rodou)
    return queueDbWrite(() => prisma.scheduledSend.deleteMany({ where: { id: { in: ids }, status: 'scheduled' } }));
  },
  deleteMany(ids) {
    return queueDbWrite(() => prisma.scheduledSend.deleteMany({ where: { id: { in: ids } } }));
  },

  get(id) {
    return prisma.scheduledSend.findUnique({
      where: { id },
      include: { message: true, account: true, campaign: { select: { nome: true } }, targets: { orderBy: { criadoEm: 'asc' } } },
    });
  },

  // Disparos vencidos e prontos para processar.
  listDue() {
    return prisma.scheduledSend.findMany({
      where: { status: 'scheduled', agendadoPara: { lte: new Date() } },
      orderBy: { agendadoPara: 'asc' },
    });
  },

  // Disparos de uma campanha num intervalo (Calendário — M9.4).
  listRange(campaignId, de, ate) {
    return prisma.scheduledSend.findMany({
      where: { campaignId, agendadoPara: { gte: de, lte: ate } },
      orderBy: { agendadoPara: 'asc' },
      include: {
        account: { select: { nome: true } },
        message: { select: { conteudo: true } },
      },
    });
  },

  // Próximos agendamentos (Home — M8.7).
  listUpcoming(limit = 8) {
    return prisma.scheduledSend.findMany({
      where: { status: { in: ['scheduled', 'processing'] } },
      orderBy: { agendadoPara: 'asc' },
      take: limit,
      include: { campaign: { select: { nome: true } } },
    });
  },

  setStatus(id, status, extra = {}) {
    return queueDbWrite(() => prisma.scheduledSend.update({ where: { id }, data: { status, ...extra } }));
  },

  setResultado(id, resultado) {
    return queueDbWrite(() => prisma.scheduledSend.update({ where: { id }, data: { resultado: JSON.stringify(resultado) } }));
  },

  remove(id) {
    return queueDbWrite(() => prisma.scheduledSend.delete({ where: { id } }));
  },

  async ensureTargets(sendOrId) {
    return queueDbWrite(() => prisma.$transaction(async (tx) => {
      const send = typeof sendOrId === 'string'
        ? await tx.scheduledSend.findUnique({ where: { id: sendOrId }, include: { targets: true } })
        : await tx.scheduledSend.findUnique({ where: { id: sendOrId.id }, include: { targets: true } });
      if (!send) return [];
      if (send.targets.length > 0) return send.targets;

      const groupIds = parseGruposAlvo(send);
      let legacyResults = [];
      try {
        legacyResults = send.resultado ? JSON.parse(send.resultado) : [];
      } catch {
        legacyResults = [];
      }
      if (!Array.isArray(legacyResults)) legacyResults = [];
      const legacyByGroup = new Map(legacyResults.filter((r) => r?.groupId).map((r) => [r.groupId, r]));
      const rows = await buildTargetRows(tx, send, groupIds);
      const now = new Date();
      const data = rows.map((row) => {
        const legacy = legacyByGroup.get(row.groupId);
        if (!legacy) return row;
        return {
          ...row,
          status: legacy.ok ? 'sent' : 'failed',
          tentativa: 1,
          erro: legacy.ok ? null : (legacy.error || 'send_failed'),
          resultado: legacy.ok ? JSON.stringify({ sample: legacy.sample || null }) : null,
          iniciadoEm: send.iniciadoEm || send.criadoEm || now,
          finalizadoEm: send.finalizadoEm || now,
        };
      });
      if (data.length > 0) {
        await tx.scheduledSendTarget.createMany({ data });
      }
      return tx.scheduledSendTarget.findMany({ where: { scheduledSendId: send.id }, orderBy: { criadoEm: 'asc' } });
    }));
  },

  listTargets(sendId) {
    return prisma.scheduledSendTarget.findMany({
      where: { scheduledSendId: sendId },
      orderBy: { criadoEm: 'asc' },
    });
  },

  pendingTargets(sendId) {
    return prisma.scheduledSendTarget.findMany({
      where: { scheduledSendId: sendId, status: 'pending' },
      orderBy: { criadoEm: 'asc' },
    });
  },

  countPendingTargets(sendId) {
    return prisma.scheduledSendTarget.count({ where: { scheduledSendId: sendId, status: 'pending' } });
  },

  async claimSendForProcessing(id) {
    return queueDbWrite(async () => {
      const send = await prisma.scheduledSend.findUnique({
        where: { id },
        select: { id: true, accountId: true, campaignId: true, status: true },
      });
      if (!send || send.status !== 'scheduled') return null;

      const now = new Date();
      const nowIso = now.toISOString();
      const updated = await prisma.$executeRawUnsafe(
        `
          UPDATE "ScheduledSend"
             SET "status" = 'processing',
                 "iniciadoEm" = COALESCE("iniciadoEm", ?),
                 "claimedByInstanceId" = ?,
                 "claimedByPid" = ?,
                 "claimedAt" = ?
           WHERE "id" = ?
             AND "status" = 'scheduled'
             AND NOT EXISTS (
               SELECT 1
                 FROM "ScheduledSend" AS busyAccount
                WHERE busyAccount."id" <> ?
                  AND busyAccount."status" = 'processing'
                  AND busyAccount."accountId" = ?
             )
        `,
        nowIso,
        instanceId,
        process.pid,
        nowIso,
        id,
        id,
        send.accountId,
      );

      if (Number(updated) !== 1) return null;
      return this.get(id);
    });
  },

  async claimNextTarget(sendId) {
    return queueDbWrite(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = await prisma.scheduledSendTarget.findFirst({
          where: { scheduledSendId: sendId, status: 'pending' },
          orderBy: { criadoEm: 'asc' },
          select: { id: true },
        });
        if (!candidate) return null;

        const now = new Date();
        const updated = await prisma.scheduledSendTarget.updateMany({
          where: {
            id: candidate.id,
            status: 'pending',
            scheduledSend: {
              id: sendId,
              status: 'processing',
              claimedByInstanceId: instanceId,
            },
          },
          data: {
            status: 'processing',
            tentativa: { increment: 1 },
            erro: null,
            resultado: null,
            iniciadoEm: now,
            claimedByInstanceId: instanceId,
            claimedByPid: process.pid,
            claimedAt: now,
          },
        });
        if (updated.count === 1) {
          return prisma.scheduledSendTarget.findUnique({ where: { id: candidate.id } });
        }
      }
      return null;
    });
  },

  async setTargetFinal(id, status, { erro = null, resultado = null } = {}) {
    return queueDbWrite(async () => {
      const updated = await prisma.scheduledSendTarget.updateMany({
        where: { id, status: 'processing', claimedByInstanceId: instanceId },
        data: {
          status,
          erro,
          resultado: resultado ? JSON.stringify(resultado) : null,
          finalizadoEm: new Date(),
          claimedByInstanceId: null,
          claimedByPid: null,
          claimedAt: null,
        },
      });
      if (updated.count !== 1) return null;
      return prisma.scheduledSendTarget.findUnique({ where: { id } });
    });
  },

  resetProcessingTargets(sendId = null) {
    return queueDbWrite(() => prisma.scheduledSendTarget.updateMany({
      where: {
        ...(sendId ? { scheduledSendId: sendId } : {}),
        status: 'processing',
      },
      data: { status: 'pending', erro: null, claimedByInstanceId: null, claimedByPid: null, claimedAt: null },
    }));
  },

  async requeueProcessingSend(sendId, { delaySeconds = 30 } = {}) {
    await this.resetProcessingTargets(sendId);
    await this.syncResultadoFromTargets(sendId);
    return this.setStatus(sendId, 'scheduled', {
      agendadoPara: new Date(Date.now() + delaySeconds * 1000),
      claimedByInstanceId: null,
      claimedByPid: null,
      claimedAt: null,
    });
  },

  failOpenTargets(sendId, erro) {
    return queueDbWrite(() => prisma.scheduledSendTarget.updateMany({
      where: { scheduledSendId: sendId, status: { in: ['pending', 'processing'] } },
      data: {
        status: 'failed',
        erro: String(erro || 'send_failed').slice(0, 180),
        finalizadoEm: new Date(),
        claimedByInstanceId: null,
        claimedByPid: null,
        claimedAt: null,
      },
    }));
  },

  async syncResultadoFromTargets(sendId) {
    const targets = await this.listTargets(sendId);
    const resultado = resultadoFromTargets(targets);
    await this.setResultado(sendId, resultado);
    return { targets, resultado };
  },

  async finishIfTargetsComplete(sendId) {
    const { targets, resultado } = await this.syncResultadoFromTargets(sendId);
    const total = targets.length;
    const finais = targets.filter((t) => FINAL_TARGET_STATUSES.includes(t.status)).length;
    const okCount = targets.filter((t) => t.status === 'sent').length;
    const failCount = targets.filter((t) => t.status === 'failed' || t.status === 'skipped').length;
    if (total === 0) {
      await this.setStatus(sendId, 'failed', { finalizadoEm: new Date(), claimedByInstanceId: null, claimedByPid: null, claimedAt: null });
      return { complete: true, status: 'failed', total, okCount, failCount, resultado };
    }
    if (total > 0 && finais === total) {
      const status = okCount > 0 ? 'sent' : 'failed';
      await this.setStatus(sendId, status, { finalizadoEm: new Date(), claimedByInstanceId: null, claimedByPid: null, claimedAt: null });
      return { complete: true, status, total, okCount, failCount, resultado };
    }
    return { complete: false, status: null, total, okCount, failCount, resultado };
  },
};
