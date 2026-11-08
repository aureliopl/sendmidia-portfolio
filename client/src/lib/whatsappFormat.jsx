// Renderiza a marcação de texto do WhatsApp como JSX, para a pré-visualização da mensagem
// mostrar igual ao que o participante verá no grupo:
//   *negrito*  _itálico_  ~tachado~  ```monoespaçado```  e linhas com "> " como citação.
// O Spintax {opção 1|opção 2} é mantido literal (não é formatação do WhatsApp). Construímos
// nós React (sem dangerouslySetInnerHTML) — seguro contra HTML malicioso no conteúdo.

// Delimitadores inline, em ordem de tentativa. O monoespaçado (```) não é reprocessado por dentro.
const DELIMS = [
  { mark: '```', tag: 'mono' },
  { mark: '*', tag: 'bold' },
  { mark: '_', tag: 'italic' },
  { mark: '~', tag: 'strike' },
];

// Links: como no WhatsApp, URLs viram links azuis clicáveis que abrem em nova aba.
const URL_RE = /(https?:\/\/[^\s]+)/gi;
const COR_LINK = '#027eb5'; // azul de link do WhatsApp Web (tema claro)

// Transforma um trecho de texto puro em nós, com as URLs viradas em <a>. Pontuação final comum
// (.,;:!?) e parênteses/aspas de fechamento não entram no link, para não "engolir" o fim da frase.
function linkify(text, keyBase) {
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  let i = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    let trailing = '';
    const corte = url.match(/[.,;:!?)\]}'"]+$/);
    if (corte) {
      trailing = corte[0];
      url = url.slice(0, url.length - trailing.length);
    }
    out.push(
      <a
        key={`${keyBase}-a${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ color: COR_LINK, textDecoration: 'none', wordBreak: 'break-all' }}
      >
        {url}
      </a>,
    );
    if (trailing) out.push(trailing);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

function wrap(tag, children, key) {
  switch (tag) {
    case 'bold':
      return <strong key={key}>{children}</strong>;
    case 'italic':
      return <em key={key}>{children}</em>;
    case 'strike':
      return <span key={key} style={{ textDecoration: 'line-through' }}>{children}</span>;
    case 'mono':
      return <code key={key} style={{ fontFamily: 'monospace', fontSize: '0.92em' }}>{children}</code>;
    default:
      return <span key={key}>{children}</span>;
  }
}

// Processa a formatação inline de um trecho (recursivo para permitir aninhamento, ex.: *_x_*).
function parseInline(text, keyBase) {
  const out = [];
  let rest = text;
  let i = 0;
  while (rest.length) {
    // acha o delimitador com par mais à esquerda
    let best = null;
    for (const d of DELIMS) {
      const start = rest.indexOf(d.mark);
      if (start === -1) continue;
      const end = rest.indexOf(d.mark, start + d.mark.length);
      if (end === -1 || end === start + d.mark.length) continue; // sem par ou vazio
      if (best === null || start < best.start) best = { ...d, start, end };
    }
    if (!best) {
      out.push(...linkify(rest, `${keyBase}-t${i}`));
      break;
    }
    if (best.start > 0) out.push(...linkify(rest.slice(0, best.start), `${keyBase}-t${i}`));
    const inner = rest.slice(best.start + best.mark.length, best.end);
    const key = `${keyBase}-${i}`;
    const children = best.tag === 'mono' ? inner : parseInline(inner, key);
    out.push(wrap(best.tag, children, key));
    rest = rest.slice(best.end + best.mark.length);
    i += 1;
  }
  return out;
}

// Renderiza o texto completo (linha a linha, tratando citações) como JSX.
export function renderWhatsApp(text) {
  if (!text) return null;
  const linhas = String(text).split('\n');
  return linhas.map((linha, idx) => {
    const ehCitacao = /^>\s?/.test(linha);
    const conteudo = ehCitacao ? linha.replace(/^>\s?/, '') : linha;
    const nodes = parseInline(conteudo, `l${idx}`);
    const corpo = ehCitacao ? (
      <span
        style={{
          display: 'inline-block',
          borderLeft: '3px solid var(--mantine-color-gray-4)',
          paddingLeft: 8,
          color: 'var(--mantine-color-gray-7)',
        }}
      >
        {nodes}
      </span>
    ) : (
      nodes
    );
    return (
      <span key={idx}>
        {corpo}
        {idx < linhas.length - 1 ? <br /> : null}
      </span>
    );
  });
}
