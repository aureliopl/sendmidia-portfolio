// Spintax — função anti-banimento central (CLAUDE.md §6). Detecta blocos
// {opção 1|opção 2|...} e sorteia UMA variação por chamada, de forma independente
// por bloco. Suporta aninhamento, ex.: "Olá {pessoal|{galera|time}}!".
//
// Esta é a implementação AUTORITATIVA: o preview no compositor (M7) e o disparo
// real (M8) usam exatamente este código, evitando divergência entre o que o
// usuário vê e o que é enviado.

// Faz o parse de uma sequência (literais + blocos de escolha). Quando insideChoice,
// para em '|' ou '}' (delimitadores do bloco atual).
function parseSequence(str, i, insideChoice) {
  const nodes = [];
  let lit = '';
  const flush = () => {
    if (lit) nodes.push({ t: 'lit', v: lit });
    lit = '';
  };
  while (i < str.length) {
    const c = str[i];
    if (c === '{') {
      flush();
      const [choice, next] = parseChoice(str, i);
      nodes.push(choice);
      i = next;
    } else if (insideChoice && (c === '|' || c === '}')) {
      break;
    } else {
      lit += c;
      i += 1;
    }
  }
  flush();
  return [nodes, i];
}

// str[i] === '{'. Lê as alternativas separadas por '|' até o '}' correspondente.
function parseChoice(str, i) {
  i += 1; // pula '{'
  const alts = [];
  while (i <= str.length) {
    const [seq, next] = parseSequence(str, i, true);
    alts.push(seq);
    i = next;
    if (str[i] === '|') {
      i += 1;
      continue;
    }
    if (str[i] === '}') {
      i += 1;
      break;
    }
    // '{' sem fechamento: encerra o bloco com o que tiver (degrada sem quebrar).
    break;
  }
  return [{ t: 'choice', alts }, i];
}

function sampleSeq(nodes) {
  return nodes
    .map((n) => (n.t === 'lit' ? n.v : sampleSeq(n.alts[Math.floor(Math.random() * n.alts.length)])))
    .join('');
}

function countSeq(nodes) {
  return nodes.reduce(
    (acc, n) => acc * (n.t === 'lit' ? 1 : n.alts.reduce((s, a) => s + countSeq(a), 0)),
    1,
  );
}

// Sorteia uma variação do texto com Spintax.
export function spin(text) {
  const [seq] = parseSequence(String(text ?? ''), 0, false);
  return sampleSeq(seq);
}

// Quantas variações distintas o texto pode gerar (produto dos blocos).
export function countVariations(text) {
  const [seq] = parseSequence(String(text ?? ''), 0, false);
  return countSeq(seq);
}
