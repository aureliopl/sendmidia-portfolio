import { prisma } from '../db.js';
import { groupsRepo } from '../repositories/index.js';
import { numeroDoGrupo } from '../repositories/groups.js';
import { createGroup, getSock } from '../whatsapp/manager.js';

// Cria UM grupo real na campanha aplicando a política de abertura da interação (anti-banimento):
// se a campanha abre a interação (aberturaInteracaoHoras > 0), o grupo nasce ABERTO (todos enviam)
// e agenda o fechamento (fecharInteracaoEm = agora + horas); senão nasce FECHADO (só admin envia).
// Persiste o grupo na campanha. Reusado pela criação manual (rota) e pelo auto-create do link.
// `campaign`: objeto com { id, aberturaInteracaoHoras }. Lança se a conta não estiver conectada.
export async function criarGrupoNaCampanha(campaign, accountId, nome, { aprovarEntrada = false } = {}) {
  const horas = campaign.aberturaInteracaoHoras ?? 24;
  const abre = horas > 0;
  const criado = await createGroup(accountId, nome, { soAdminEnvia: !abre, aprovarEntrada });
  const fecharInteracaoEm = abre ? new Date(Date.now() + horas * 3600 * 1000) : null;
  return groupsRepo.create(campaign.id, accountId, { ...criado, fecharInteracaoEm });
}

// Próximo nome na sequência #NN dos grupos da campanha. Deriva a base do grupo de maior #
// (removendo o "#NN") e devolve "<base> #<N+1>". Sem grupos numerados, começa em #01 a partir
// do nome de um grupo existente ou do nome da campanha.
function proximoNome(grupos, nomeCampanha) {
  let maxN = 0;
  let base = null;
  for (const g of grupos) {
    const n = numeroDoGrupo(g.nome);
    if (Number.isFinite(n)) {
      if (n >= maxN) { maxN = n; base = g.nome.replace(/#\d+/, '').trim(); }
    } else if (base === null) {
      base = g.nome.trim();
    }
  }
  if (!base) base = (nomeCampanha || 'Grupo').trim();
  return `${base} #${String(maxN + 1).padStart(2, '0')}`;
}

// Trava por campanha: criações concorrentes (vários cliques ao mesmo tempo) compartilham a
// MESMA Promise, então só um grupo é criado por vez. Evita abrir vários grupos de uma vez.
const criacaoEmAndamento = new Map();

// Garante um grupo aberto para o redirect do link geral quando não há vaga (Leva 2b — MUTAÇÃO
// REAL: cria um grupo no WhatsApp). Re-checa sob a trava (outro clique pode já ter criado/aberto).
// Usa a CONTA CRIADORA da campanha (precisa estar associada e conectada). Devolve o grupo novo
// (com linkConvite) ou `null` quando não dá para criar (sem criadora, criadora offline, ou erro).
export async function garantirGrupoAberto(campaign) {
  const campaignId = campaign.id;
  if (criacaoEmAndamento.has(campaignId)) return criacaoEmAndamento.get(campaignId);

  const tarefa = (async () => {
    const cap = campaign.capacidadeGrupo ?? 600;
    // re-checa: já surgiu um grupo aberto com vaga?
    const aberto = await prisma.group.findFirst({
      where: { campaignId, status: 'open', linkConvite: { not: null }, participantes: { lt: cap } },
      select: { id: true, linkConvite: true },
    });
    if (aberto) return aberto;

    const criadoraId = campaign.contaCriadoraId;
    if (!criadoraId || !getSock(criadoraId)) return null; // sem criadora ou offline

    const grupos = await prisma.group.findMany({ where: { campaignId }, select: { nome: true } });
    const nome = proximoNome(grupos, campaign.nome);
    try {
      return await criarGrupoNaCampanha(campaign, criadoraId, nome);
    } catch {
      return null; // criação falhou (ex.: conta caiu no meio)
    }
  })();

  criacaoEmAndamento.set(campaignId, tarefa);
  try {
    return await tarefa;
  } finally {
    criacaoEmAndamento.delete(campaignId);
  }
}
