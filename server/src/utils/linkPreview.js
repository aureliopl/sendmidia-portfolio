import sharp from 'sharp';

// Geração própria do preview de link (sem a dependência link-preview-js, que tem SSRF conhecido).
// Lemos as meta tags OpenGraph/Twitter do 1º link e geramos o thumbnail JPEG com sharp (que já
// vem com o Baileys). Inclui uma checagem básica de host para não buscar endereços internos.

const URL_RE = /(https?:\/\/[^\s]+)/i;
const FETCH_TIMEOUT_MS = 6000;
const UA = 'Mozilla/5.0 (compatible; SendMidiaBot/1.0)';

// Bloqueia hosts locais/privados óbvios (mitiga SSRF para a rede interna). Não é proteção
// completa (não cobre DNS rebinding/redirects para IP interno), mas o uso é single-user e as
// URLs vêm do próprio dono.
export function hostPermitido(urlStr) {
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// Extrai uma meta tag OpenGraph/Twitter do HTML (busca por property OU name, em qualquer ordem).
export function metaTag(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

async function fetchComTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA }, ...opts });
  } finally {
    clearTimeout(timer);
  }
}

// Lê título/descrição/imagem OpenGraph de uma URL (read-only). Devolve { url, title, description,
// image } ou null. Reutilizado pelo endpoint /api/link-preview e pelo envio.
export async function fetchOgPreview(url) {
  return null; // Sem acesso a URLs externas na demonstracao.
  if (!hostPermitido(url)) return null;
  const res = await fetchComTimeout(url);
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    // o link aponta direto para uma imagem: ela mesma é o preview
    return { url, image: url, title: null, description: null };
  }
  if (!ct.includes('text/html')) return { url, image: null, title: null, description: null };
  const html = (await res.text()).slice(0, 500_000);
  return {
    url,
    image: metaTag(html, 'og:image') || metaTag(html, 'twitter:image'),
    title: metaTag(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null),
    description: metaTag(html, 'og:description') || metaTag(html, 'description'),
  };
}

// Baixa a imagem do preview e gera um thumbnail JPEG pequeno (formato esperado pelo WhatsApp).
async function gerarThumbnail(imageUrl) {
  if (!hostPermitido(imageUrl)) return null;
  const res = await fetchComTimeout(imageUrl);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).resize(192, 192, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
}

// Monta o objeto de preview de link no formato que o Baileys aceita em `sendMessage({ text,
// linkPreview })`. Devolve null se não houver link ou não der para montar (o envio segue sem
// preview). Encontra o 1º link do texto; o `matched-text` deve ser o link como aparece no texto.
export async function buildWaLinkPreview(text) {
  const link = String(text || '').match(URL_RE)?.[1];
  if (!link) return null;
  let og;
  try {
    og = await fetchOgPreview(link);
  } catch {
    return null;
  }
  if (!og || (!og.title && !og.image)) return null;

  const preview = {
    'canonical-url': og.url || link,
    'matched-text': link,
    title: og.title || link,
    description: og.description || '',
  };
  if (og.image) {
    try {
      const thumb = await gerarThumbnail(og.image);
      if (thumb) {
        preview.jpegThumbnail = thumb;
        preview.originalThumbnailUrl = og.image;
      }
    } catch {
      // sem imagem: ainda envia o card com título/descrição
    }
  }
  return preview;
}
