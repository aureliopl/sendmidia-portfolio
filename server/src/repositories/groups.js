import { prisma } from '../db.js';

// Extrai o "#NN" do nome do grupo (regra do dono p/ duplicados: o contato permanece no
// grupo de MENOR número). Sem "#NN" no nome → Infinity (vai para o fim do desempate).
export function numeroDoGrupo(nome) {
  const m = /#(\d+)/.exec(nome || '');
  return m ? parseInt(m[1], 10) : Infinity;
}

// Repositório de Grupos (persistidos numa campanha). As ações reais no WhatsApp
// (Baileys) ficam no manager; aqui é só o estado local.
export const groupsRepo = {
  // filtro: todos | full | available | suspended (duplicados é calculado à parte)
  list(campaignId, { filtro } = {}) {
    const where = { campaignId };
    if (filtro === 'full') where.status = 'full';
    else if (filtro === 'suspended') where.status = 'suspended';
    else if (filtro === 'available') where.status = { in: ['open', 'closed'] };
    return prisma.group.findMany({ where, orderBy: { nome: 'asc' } });
  },

  get(id) {
    return prisma.group.findUnique({ where: { id } });
  },

  // Quais waGroupIds dessa campanha já tem (para não importar duplicado).
  async existingWaIds(campaignId) {
    const rows = await prisma.group.findMany({
      where: { campaignId, waGroupId: { not: null } },
      select: { waGroupId: true },
    });
    return new Set(rows.map((r) => r.waGroupId));
  },

  // Importa em lote grupos já existentes no WhatsApp para a campanha.
  // Capacidade configurada da campanha (default 600). Usada como `capacidade` dos grupos.
  async capacidadeDaCampanha(campaignId) {
    const c = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { capacidadeGrupo: true } });
    return c?.capacidadeGrupo ?? 600;
  },

  async importMany(campaignId, accountId, grupos) {
    const existentes = await this.existingWaIds(campaignId);
    const novos = grupos.filter((g) => g.waGroupId && !existentes.has(g.waGroupId));
    if (novos.length === 0) return { importados: 0 };
    const capacidade = await this.capacidadeDaCampanha(campaignId);
    await prisma.group.createMany({
      data: novos.map((g) => ({
        campaignId,
        accountId,
        waGroupId: g.waGroupId,
        nome: g.nome || '(sem nome)',
        participantes: g.participantes || 0,
        capacidade,
        status: 'open',
      })),
    });
    return { importados: novos.length };
  },

  // Persiste um grupo recém-criado no WhatsApp (M6.2) já com link/participantes.
  // `fecharInteracaoEm` (opcional): quando o worker deve fechar a interação (só admin envia).
  async create(campaignId, accountId, { waGroupId, nome, participantes, linkConvite, fecharInteracaoEm }) {
    const capacidade = await this.capacidadeDaCampanha(campaignId);
    return prisma.group.create({
      data: {
        campaignId,
        accountId,
        waGroupId,
        nome: nome || '(sem nome)',
        participantes: participantes || 0,
        linkConvite: linkConvite || null,
        capacidade,
        status: 'open',
        fecharInteracaoEm: fecharInteracaoEm || null,
      },
    });
  },

  // Grupos cuja janela de abertura da interação já venceu (fecharInteracaoEm <= agora). O worker
  // fecha a interação (só admin envia) e depois chama `marcarInteracaoFechada`. Traz só os que têm
  // waGroupId e a conta dona, agrupáveis por conta. Teto pequeno (processa aos poucos).
  interacoesVencidas(limite = 20) {
    return prisma.group.findMany({
      where: { fecharInteracaoEm: { not: null, lte: new Date() }, waGroupId: { not: null } },
      select: { id: true, waGroupId: true, accountId: true, nome: true, campaignId: true },
      take: limite,
    });
  },

  marcarInteracaoFechada(groupId) {
    return prisma.group.update({ where: { id: groupId }, data: { fecharInteracaoEm: null } });
  },

  setStatusMany(ids, status) {
    return prisma.group.updateMany({ where: { id: { in: ids } }, data: { status } });
  },

  setLink(id, linkConvite) {
    return prisma.group.update({ where: { id }, data: { linkConvite } });
  },

  // Atualiza o nome local do grupo após renomear no WhatsApp (M6.3).
  setNome(id, nome) {
    return prisma.group.update({ where: { id }, data: { nome } });
  },

  removeMany(ids) {
    return prisma.group.deleteMany({ where: { id: { in: ids } } });
  },

  // Substitui a lista de participantes de um grupo (M6.6). `participantes` é [{numero, jid}]
  // (vide manager.participantInfo); `total` é a contagem real do grupo (do WhatsApp).
  async syncParticipants(groupId, participantes, total) {
    const vistos = new Set();
    const data = [];
    for (const p of participantes || []) {
      if (!p?.numero || vistos.has(p.numero)) continue;
      vistos.add(p.numero);
      data.push({ groupId, numero: p.numero, jid: p.jid || null });
    }
    const contagem = total ?? data.length;
    await prisma.$transaction([
      prisma.groupParticipant.deleteMany({ where: { groupId } }),
      prisma.groupParticipant.createMany({ data }),
      prisma.group.update({ where: { id: groupId }, data: { participantes: contagem } }),
    ]);
    await this.aplicarAutoCheio(groupId, contagem);
    return data.length;
  },

  // Vira o grupo para "full" automaticamente quando a contagem atinge a capacidade da campanha
  // (deep linking — grupo cheio sai da rotação do link geral). Só age sobre grupos "open" (não
  // mexe em closed/suspended, nem reabre — reabrir é decisão manual do dono via "não cheio").
  async aplicarAutoCheio(groupId, contagem) {
    const grupo = await prisma.group.findUnique({
      where: { id: groupId },
      select: { status: true, participantes: true, campaign: { select: { capacidadeGrupo: true } } },
    });
    if (!grupo) return;
    const total = contagem ?? grupo.participantes;
    const cap = grupo.campaign?.capacidadeGrupo ?? 600;
    if (grupo.status === 'open' && total >= cap) {
      await prisma.group.update({ where: { id: groupId }, data: { status: 'full' } });
    }
  },

  // Participantes que aparecem em mais de um grupo da campanha (M6.6). Para cada número,
  // devolve os grupos onde está e marca qual seria MANTIDO pela regra do menor "#NN"
  // (os demais seriam removidos). Read-only — não muta nada no WhatsApp.
  // `protegidos` (Set de números) são excluídos: números administradores/protegidos nunca
  // entram como duplicados nem são removidos.
  async findDuplicates(campaignId, protegidos = new Set()) {
    const grupos = await prisma.group.findMany({
      where: { campaignId },
      select: { id: true, nome: true, waGroupId: true, accountId: true, participants: { select: { numero: true, jid: true } } },
    });
    const porNumero = new Map();
    for (const g of grupos) {
      for (const p of g.participants) {
        if (protegidos.has(p.numero)) continue; // número administrador/protegido — fora dos duplicados
        if (!porNumero.has(p.numero)) porNumero.set(p.numero, []);
        porNumero.get(p.numero).push({ groupId: g.id, nome: g.nome, waGroupId: g.waGroupId, accountId: g.accountId, jid: p.jid });
      }
    }
    const dups = [];
    for (const [numero, gs] of porNumero) {
      if (gs.length < 2) continue;
      // ordena por menor #NN (desempate pelo nome p/ ser determinístico); o 1º é mantido.
      const ordenados = [...gs].sort((a, b) => numeroDoGrupo(a.nome) - numeroDoGrupo(b.nome) || a.nome.localeCompare(b.nome));
      dups.push({
        numero,
        grupos: ordenados.map((g, i) => ({ ...g, manter: i === 0 })),
      });
    }
    // mais "espalhados" primeiro
    dups.sort((a, b) => b.grupos.length - a.grupos.length);
    return dups;
  },
};
