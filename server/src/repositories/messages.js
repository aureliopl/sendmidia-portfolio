import { prisma } from '../db.js';

const MAX_BLOCOS = 5;

// Normaliza um bloco vindo do cliente. Um bloco é texto, mídia (com legenda), enquete ou contato.
// Descarta blocos inválidos (sem conteúdo aproveitável).
function sanitizeBloco(b) {
  // Enquete: pergunta + 2 a 12 opções distintas.
  if (b?.tipo === 'enquete') {
    const pergunta = typeof b.pergunta === 'string' ? b.pergunta.trim() : '';
    const opcoes = Array.isArray(b.opcoes)
      ? [...new Set(b.opcoes.map((o) => String(o ?? '').trim()).filter(Boolean))].slice(0, 12)
      : [];
    if (!pergunta || opcoes.length < 2) return null;
    return { tipo: 'enquete', pergunta, opcoes, multiplas: b.multiplas === true };
  }
  // Contato: nome + número (só dígitos).
  if (b?.tipo === 'contato') {
    const nome = typeof b.nome === 'string' ? b.nome.trim() : '';
    const numero = String(b.numero ?? '').replace(/\D/g, '');
    if (!nome || numero.length < 8) return null;
    return { tipo: 'contato', nome, numero };
  }
  const midia = typeof b?.midia === 'string' && b.midia ? b.midia : null;
  const conteudo = typeof b?.conteudo === 'string' ? b.conteudo : '';
  if (!midia && !conteudo.trim()) return null;
  const bloco = {
    tipo: midia ? 'midia' : 'texto',
    conteudo,
    midia,
    midiaTipo: midia ? b.midiaTipo || null : null,
    midiaNome: midia ? b.midiaNome || null : null,
    usarPreviewLink: b?.usarPreviewLink !== false,
  };
  // Preview de link persistido (só para a pré-visualização na UI; o envio gera o card de novo).
  const lp = b?.linkPreview;
  if (!midia && lp && typeof lp === 'object') {
    const str = (v) => (typeof v === 'string' ? v : null);
    bloco.linkPreview = { url: str(lp.url), image: str(lp.image), title: str(lp.title), description: str(lp.description) };
  }
  return bloco;
}

function sanitizeBlocos(blocos) {
  if (!Array.isArray(blocos)) return [];
  return blocos.map(sanitizeBloco).filter(Boolean).slice(0, MAX_BLOCOS);
}

// Resumo textual da mensagem (1º bloco com texto, senão um rótulo de mídia) — usado em
// listagens/calendário e no campo `conteudo` (retrocompat).
function resumoDeBlocos(blocos) {
  const t = blocos.find((b) => b.conteudo && b.conteudo.trim());
  if (t) return t.conteudo;
  const b = blocos[0];
  if (!b) return '';
  if (b.tipo === 'enquete') return `[enquete] ${b.pergunta}`;
  if (b.tipo === 'contato') return `[contato] ${b.nome}`;
  return `[${b.midiaTipo || 'mídia'}]`;
}

// Deriva o(s) bloco(s) de uma mensagem legada (sem `blocos`, só conteudo/midia).
function legadoBloco(m) {
  const midia = m.midia || null;
  return {
    tipo: midia ? 'midia' : 'texto',
    conteudo: m.conteudo || '',
    midia,
    midiaTipo: midia ? m.midiaTipo || null : null,
    midiaNome: midia ? m.midiaNome || null : null,
    usarPreviewLink: m.usarPreviewLink !== false,
  };
}

// Repositório de Mensagens. A fonte de verdade é `blocos` (JSON); conteudo/midia ficam como
// resumo do 1º bloco para telas que mostram preview e para mensagens antigas.
export const messagesRepo = {
  list(campaignId) {
    return prisma.message.findMany({ where: { campaignId }, orderBy: { criadoEm: 'desc' } });
  },

  // Página de mensagens (mais recentes primeiro). Evita carregar todas de uma vez.
  listPaged(campaignId, { skip = 0, take = 10 } = {}) {
    return prisma.message.findMany({ where: { campaignId }, orderBy: { criadoEm: 'desc' }, skip, take });
  },

  count(campaignId) {
    return prisma.message.count({ where: { campaignId } });
  },

  get(id) {
    return prisma.message.findUnique({ where: { id } });
  },

  create(campaignId, { blocos, gruposAlvo }) {
    const bl = sanitizeBlocos(blocos);
    return prisma.message.create({
      data: {
        campaignId,
        conteudo: resumoDeBlocos(bl),
        blocos: JSON.stringify(bl),
        midia: null,
        midiaTipo: null,
        midiaNome: null,
        usarPreviewLink: bl[0]?.usarPreviewLink !== false,
        gruposAlvo: gruposAlvo ? JSON.stringify(gruposAlvo) : null,
      },
    });
  },

  update(id, { blocos, gruposAlvo }) {
    const data = {};
    if (blocos !== undefined) {
      const bl = sanitizeBlocos(blocos);
      data.blocos = JSON.stringify(bl);
      data.conteudo = resumoDeBlocos(bl);
      data.midia = null;
      data.midiaTipo = null;
      data.midiaNome = null;
      data.usarPreviewLink = bl[0]?.usarPreviewLink !== false;
    }
    if (gruposAlvo !== undefined) data.gruposAlvo = gruposAlvo ? JSON.stringify(gruposAlvo) : null;
    return prisma.message.update({ where: { id }, data });
  },

  remove(id) {
    return prisma.message.delete({ where: { id } });
  },

  async duplicate(id) {
    const m = await prisma.message.findUnique({ where: { id } });
    if (!m) return null;
    return prisma.message.create({
      data: {
        campaignId: m.campaignId,
        conteudo: m.conteudo,
        blocos: m.blocos,
        midia: m.midia,
        midiaTipo: m.midiaTipo,
        midiaNome: m.midiaNome,
        usarPreviewLink: m.usarPreviewLink,
        gruposAlvo: m.gruposAlvo,
      },
    });
  },
};

// Converte o registro do banco para a forma da API: gruposAlvo (array) + blocos (array, sempre
// com ao menos 1 bloco — derivado de conteudo/midia quando a mensagem é legada).
export function serializeMessage(m) {
  let gruposAlvo = [];
  try {
    gruposAlvo = m.gruposAlvo ? JSON.parse(m.gruposAlvo) : [];
  } catch {
    gruposAlvo = [];
  }
  let blocos = [];
  try {
    blocos = m.blocos ? JSON.parse(m.blocos) : [];
  } catch {
    blocos = [];
  }
  if (!Array.isArray(blocos) || blocos.length === 0) blocos = [legadoBloco(m)];
  return { ...m, gruposAlvo, blocos };
}
