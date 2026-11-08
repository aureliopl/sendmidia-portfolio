import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

// Mídia enviada por upload fica em DATA_DIR/uploads (disco persistente, fora do deploy). Mesma
// convenção de db.js/manager.js para resolver DATA_DIR (relativo ou absoluto) em runtime.
export const uploadsDir = process.env.DATA_DIR
  ? path.resolve(repoRoot, process.env.DATA_DIR, 'uploads')
  : path.join(repoRoot, 'data', 'uploads');

// Os arquivos enviados são autoexcluídos depois deste prazo (informado ao usuário na UI).
export const UPLOAD_MAX_DAYS = 90;
const PUBLIC_PREFIX = '/api/uploads/';

export async function ensureUploadsDir() {
  await mkdir(uploadsDir, { recursive: true }).catch(() => {});
}

// Extensões aceitas por tipo de mídia (validação leve do upload).
const EXT_POR_TIPO = {
  image: ['jpg', 'jpeg', 'png', 'webp'],
  gif: ['gif', 'mp4'],
  sticker: ['png', 'webp', 'jpg', 'jpeg'],
  video: ['mp4', 'mov', '3gp', 'mkv', 'webm'],
  audio: ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'csv'],
};

export function tipoValido(tipo) {
  return Object.prototype.hasOwnProperty.call(EXT_POR_TIPO, tipo);
}

// Caminho público (guardado em Message.midia e usado como src no cliente) para um arquivo local.
export function publicPath(fileName) {
  return PUBLIC_PREFIX + fileName;
}

// Nome de arquivo seguro: rejeita (devolve null) qualquer coisa com separador de caminho, ".."
// ou caracteres fora de [A-Za-z0-9._-] — evita path traversal ao servir/ler.
export function safeFileName(name) {
  const s = String(name || '');
  if (s.includes('/') || s.includes('\\') || s.includes('..')) return null;
  return /^[\w.-]+$/.test(s) ? s : null;
}

// Dado o valor de Message.midia, devolve o caminho ABSOLUTO no disco se for um upload local
// (/api/uploads/<arquivo>); devolve null se for URL externa (http) ou inválido. O worker usa
// isto para enviar a mídia a partir do disco; URLs externas vão direto pelo `url` ao Baileys.
export function localFilePath(midia) {
  if (typeof midia !== 'string' || !midia.startsWith(PUBLIC_PREFIX)) return null;
  const file = safeFileName(midia.slice(PUBLIC_PREFIX.length));
  return file ? path.join(uploadsDir, file) : null;
}

// Content-Type básico pela extensão (para servir os arquivos).
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export function mimePorExt(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// Stream de leitura de um arquivo enviado (ou null se o nome for inválido ou não existir).
export function readUpload(fileName) {
  const safe = safeFileName(fileName);
  if (!safe) return null;
  const p = path.join(uploadsDir, safe);
  if (!existsSync(p)) return null;
  return createReadStream(p);
}

// Remove os uploads com mais de UPLOAD_MAX_DAYS dias (autolimpeza). Devolve quantos removeu.
export async function cleanupOldUploads(maxDays = UPLOAD_MAX_DAYS) {
  await ensureUploadsDir();
  const limite = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  let removidos = 0;
  let arquivos = [];
  try {
    arquivos = await readdir(uploadsDir);
  } catch {
    return 0;
  }
  for (const nome of arquivos) {
    try {
      const p = path.join(uploadsDir, nome);
      const s = await stat(p);
      if (s.isFile() && s.mtimeMs < limite) {
        await unlink(p);
        removidos += 1;
      }
    } catch {
      // arquivo já removido ou inacessível — segue
    }
  }
  return removidos;
}

let cleanupTimer = null;
// Inicia a autolimpeza: roda no boot e a cada 24h.
export function startUploadCleanup() {
  cleanupOldUploads().catch(() => {});
  if (!cleanupTimer) cleanupTimer = setInterval(() => cleanupOldUploads().catch(() => {}), 24 * 60 * 60 * 1000);
}
export function stopUploadCleanup() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
