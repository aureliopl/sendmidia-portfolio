// Spintax no cliente — usado só na PRÉ-VISUALIZAÇÃO do compositor (mostra uma variação já
// resolvida, sem os blocos {a|b|c}). O disparo real usa a implementação autoritativa do
// servidor (server/src/utils/spintax.js); a lógica de parse aqui é a mesma.
//
// Diferença: aqui o sorteio é SEEDADO (PRNG determinístico). Assim a variação fica estável
// enquanto o usuário digita (o mesmo seed escolhe as mesmas opções) e só muda quando ele
// pede outra variação (incrementando o seed).

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
    break;
  }
  return [{ t: 'choice', alts }, i];
}

// PRNG determinístico (mulberry32): mesmo seed → mesma sequência de escolhas.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleSeq(nodes, rng) {
  return nodes
    .map((n) => (n.t === 'lit' ? n.v : sampleSeq(n.alts[Math.floor(rng() * n.alts.length)], rng)))
    .join('');
}

function countSeq(nodes) {
  return nodes.reduce(
    (acc, n) => acc * (n.t === 'lit' ? 1 : n.alts.reduce((s, a) => s + countSeq(a), 0)),
    1,
  );
}

// Resolve o Spintax do texto numa variação (determinística pelo seed).
export function spin(text, seed = 0) {
  const [seq] = parseSequence(String(text ?? ''), 0, false);
  return sampleSeq(seq, mulberry32(seed));
}

// Quantas variações distintas o texto pode gerar.
export function countVariations(text) {
  const [seq] = parseSequence(String(text ?? ''), 0, false);
  return countSeq(seq);
}

// Há pelo menos um bloco de Spintax no texto?
export function hasSpintax(text) {
  return countVariations(text) > 1;
}
