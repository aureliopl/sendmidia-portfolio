import { EXTERNAL_INTEGRATIONS_ENABLED, requireExternalIntegration } from '../portfolio.js';
import { AUTHENTICATED_ROOM } from '../security.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { esperaReconexao, MAX_TENTATIVAS_QR } from './connectionPolicy.js';
import { observarConexao } from '../alerts/monitor.js';
import { accountsRepo, contactsRepo, groupActivitiesRepo, leadEventsRepo } from '../repositories/index.js';
import { isLeaderProcess } from '../leadership.js';
import { instanceId, safeError } from '../runtime.js';
import {
  acquireAccountOwnership,
  assertAccountOwnership,
  isAccountOwnedByCurrentInstance,
  ownsAccountLocally,
  releaseAccountOwnership,
} from '../accountOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const sessionsDir = process.env.DATA_DIR
  ? path.resolve(repoRoot, process.env.DATA_DIR, 'sessions')
  : path.join(repoRoot, 'data', 'sessions');

const baileysLogger = pino({ level: 'silent' });
const disconnectReasonNames = Object.fromEntries(
  Object.entries(DisconnectReason)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value, name]),
);

// accountId -> { sock, attempts, lastPairing, hadConnected }
const sessions = new Map();
// accountIds cuja sessão foi encerrada deliberadamente (stopSession) — evita que o
// handler de "close" trate como queda de conexão e dispare reconexão automática.
const intentionalStops = new Set();

// accountId -> nº de reconexões consecutivas desde a última conexão bem-sucedida.
// Persiste entre ciclos de startSession() (cada ciclo cria um `entry` novo) para o
// backoff crescer de fato; zerado ao conectar (M10.6 — robustez de reconexão).
const reconnectAttempts = new Map();

const reconnectTimers = new Map();
// accountId -> instante (epoch ms) antes do qual NENHUMA reconexão pode acontecer. É o que impede
// o watchdog de furar a espera e voltar a martelar o WhatsApp.
const nextAttemptAt = new Map();
const saveCredsQueues = new Map();

function nextBackoff(accountId, statusCode) {
  const n = reconnectAttempts.get(accountId) || 0;
  reconnectAttempts.set(accountId, n + 1);
  return esperaReconexao(n, statusCode);
}

// FONTE DE VERDADE de "esta conta está pareada": existir credencial salva em disco.
// NÃO usar `creds.registered` do Baileys: medido em produção em 29/07/2026, ele é `false` em TODAS
// as contas pareadas e funcionando (só diz respeito ao fluxo de pairing code). Confiar nele marcou
// as 6 contas como "sem sessão" numa queda banal de rede e exigiu novo QR sem necessidade.
function hasStoredCreds(accountId) {
  return existsSync(path.join(sessionPathFor(accountId), 'creds.json'));
}

let io = null;
let logger = null;
let whatsappControlEnabled = true;
let restoreTimer = null;
let restoreRunning = false;
export function attachIO(ioServer) {
  io = ioServer;
}
export function attachLogger(appLogger) {
  logger = appLogger;
}
export function setWhatsappControlEnabled(enabled) {
  whatsappControlEnabled = Boolean(enabled);
  if (!whatsappControlEnabled) clearAllReconnectTimers();
}

function emit(event, payload) {
  if (io) io.to(AUTHENTICATED_ROOM).emit(event, payload);
}

function canTouchWhatsapp() {
  return EXTERNAL_INTEGRATIONS_ENABLED && whatsappControlEnabled && isLeaderProcess();
}

function notLeaderError() {
  const err = new Error('not_leader');
  err.code = 'not_leader';
  return err;
}

function assertWhatsappLeader() {
  requireExternalIntegration();
  if (!canTouchWhatsapp()) throw notLeaderError();
}

async function assertSessionOwner(accountId) {
  await assertAccountOwnership(accountId);
}

async function ensureLiveOwnership(accountId, entry) {
  const owned = await isAccountOwnedByCurrentInstance(accountId);
  if (owned) return true;

  clearReconnectTimer(accountId);
  sessions.delete(accountId);
  try {
    entry?.sock?.end(undefined);
  } catch {
    // socket já pode estar fechado
  }
  logConnection(accountId, 'ownership_lost', {});
  return false;
}

function guardOwnedEffect(accountId, fn) {
  isAccountOwnedByCurrentInstance(accountId)
    .then((owned) => {
      if (owned) fn();
    })
    .catch(() => {});
}

function logConnection(accountId, stage, extra = {}) {
  // TODO evento de conexão passa por aqui, então este é o único ponto que o monitor de alertas
  // precisa observar — nenhuma parte nova do manager corre o risco de "esquecer" de avisar o dono.
  // O monitor decide sozinho o que é incidente; falha dele jamais pode atrapalhar a conexão.
  try {
    observarConexao(accountId, stage, extra);
  } catch {
    // monitoramento é acessório: nunca interfere no fluxo de conexão
  }
  if (!logger) return;
  logger.info(
    {
      event: 'whatsapp_connection',
      accountId,
      stage,
      instanceId,
      pid: process.pid,
      ts: new Date().toISOString(),
      ...extra,
    },
    'Evento de conexão do WhatsApp',
  );
}

function clearReconnectTimer(accountId) {
  const timer = reconnectTimers.get(accountId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(accountId);
}

function clearAllReconnectTimers() {
  for (const accountId of reconnectTimers.keys()) clearReconnectTimer(accountId);
}

function scheduleReconnect(accountId, delay, motivo) {
  clearReconnectTimer(accountId);
  // Marca até quando esta conta está em espera. O watchdog consulta isto e nunca antecipa uma
  // reconexão — sem essa trava, o laço de supervisão viraria ele próprio um martelo.
  nextAttemptAt.set(accountId, Date.now() + delay);
  const timer = setTimeout(() => {
    reconnectTimers.delete(accountId);
    if (!canTouchWhatsapp()) {
      logConnection(accountId, 'reconnect_skipped', { motivo, delayMs: delay, skipped: 'not_leader' });
      return;
    }
    startSession(accountId).catch(() => {});
  }, delay);
  timer.unref?.();
  reconnectTimers.set(accountId, timer);
}

function disconnectInfo(lastDisconnect) {
  const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
  const error = safeError(lastDisconnect?.error);
  const reason = disconnectReasonNames[statusCode] || error.message || 'unknown';
  return { statusCode, motivo: reason, error };
}

function queueCredsSave(accountId, entry, saveCreds) {
  const previous = saveCredsQueues.get(accountId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (sessions.get(accountId) !== entry) return;
      if (!(await isAccountOwnedByCurrentInstance(accountId))) return;
      await saveCreds();
    })
    .catch((err) => {
      logConnection(accountId, 'creds_save_failed', { error: safeError(err) });
    });

  saveCredsQueues.set(accountId, next);
  next.finally(() => {
    if (saveCredsQueues.get(accountId) === next) saveCredsQueues.delete(accountId);
  });
}

// Emite (e memoriza) o estado de pareamento atual da conta. Memorizar permite
// re-emitir o estado quando o usuário reabre o modal de conexão — sem isso, o
// segundo "Iniciar sessão" de uma sessão já ativa não geraria evento e o modal
// ficaria preso em "Iniciando sessão...".
function emitPairing(accountId, payload) {
  const entry = sessions.get(accountId);
  if (entry) entry.lastPairing = payload;
  emit('account:pairing', payload);
}

// A versão do protocolo do WhatsApp Web é buscada na rede; cacheamos com validade curta (TTL)
// para não pagar um round-trip a cada início de sessão, mas ainda renovar sozinho quando o
// WhatsApp promove uma versão nova. Sem TTL, um processo de vida longa ficava preso numa versão
// obsoleta até um restart manual e o WhatsApp passava a recusar TODAS as conexões com "Connection
// Failure" (405) — foi o que ampliou o incidente de 2026-07-28.
//
// Versão de segurança conhecida (WhatsApp Web). Existe porque `fetchLatestBaileysVersion` NÃO lança
// quando a rede falha: ele devolve a versão EMBUTIDA do Baileys (que envelhece a cada release do WA)
// junto de `isLatest:false`/`error`. Essa embutida velha é recusada pelo WhatsApp com 405 — foi a
// causa do incidente de 2026-08-17, quando o GitHub (fonte da versão) ficou 503 e todas as contas
// caíram. Quando a busca falhar, preferimos ESTE valor à embutida velha. Atualizar quando o WA subir
// de versão; também é possível sobrepor sem deploy pela env `WA_WEB_VERSION` (ex.: "2.3000.1043857760").
const FALLBACK_WA_VERSION = [2, 3000, 1043857760];
// Quando a busca online falha, cacheamos o fallback por pouco tempo (não pelas 6h normais), para
// re-tentar a versão real assim que a rede/GitHub voltar.
const VERSION_RETRY_MS = 15 * 60 * 1000; // 15min

function envWaVersion() {
  const raw = process.env.WA_WEB_VERSION;
  if (!raw) return null;
  const parts = raw.split(/[.,]/).map((x) => parseInt(x.trim(), 10));
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

let cachedVersion = null;
let cachedVersionAt = 0;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
async function resolveVersion() {
  // Sobreposição explícita: permite fixar a versão sem deploy (mudança só na env + restart).
  const pinned = envWaVersion();
  if (pinned) return pinned;
  const now = Date.now();
  if (cachedVersion && now - cachedVersionAt < VERSION_TTL_MS) return cachedVersion;
  try {
    const res = await fetchLatestBaileysVersion();
    if (res && !res.error && res.isLatest !== false && Array.isArray(res.version)) {
      cachedVersion = res.version;
      cachedVersionAt = now;
    } else {
      // A busca falhou por baixo dos panos (rede/GitHub fora): a versão que veio é a embutida velha.
      // Usamos o fallback conhecido e expiramos cedo para re-tentar a real em breve, em vez de ficar
      // 6h preso numa versão que o WhatsApp recusa (405).
      cachedVersion = FALLBACK_WA_VERSION;
      cachedVersionAt = now - VERSION_TTL_MS + VERSION_RETRY_MS;
    }
  } catch {
    // fetch lançou de fato: mantém a última boa conhecida, ou cai no fallback conhecido.
    cachedVersion = cachedVersion || FALLBACK_WA_VERSION;
    cachedVersionAt = now - VERSION_TTL_MS + VERSION_RETRY_MS;
  }
  return cachedVersion;
}

function sessionPathFor(accountId) {
  return path.join(sessionsDir, accountId);
}

// Extrai o número de um jid de contato. Ignora grupos (@g.us), broadcast e ids
// vinculados (@lid) — só números de telefone reais (@s.whatsapp.net).
function jidToNumero(jid) {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
  const n = jid.split('@')[0].split(':')[0];
  return /^\d+$/.test(n) ? n : null;
}

// Extrai de um participante de grupo a melhor chave estável + o jid completo p/ ações.
// Preferimos o telefone real (PN, @s.whatsapp.net); se o grupo está em modo LID e não
// expõe o número, caímos no identificador LID (@lid), que é estável por usuário entre
// grupos — assim duplicados ainda são detectados. Os campos `jid`/`lid` separados do
// Contact (Baileys) são checados além do `id`, que pode vir em qualquer um dos formatos.
function participantInfo(p) {
  if (!p) return null;
  const pn = [p.jid, p.id].find((x) => typeof x === 'string' && x.endsWith('@s.whatsapp.net'));
  if (pn) {
    const numero = pn.split('@')[0].split(':')[0];
    if (/^\d+$/.test(numero)) return { numero, jid: `${numero}@s.whatsapp.net` };
  }
  const lid = [p.lid, p.id].find((x) => typeof x === 'string' && x.endsWith('@lid'));
  if (lid) {
    const id = lid.split('@')[0].split(':')[0];
    if (id) return { numero: id, jid: `${id}@lid` };
  }
  return null;
}

// Persiste (em background) os contatos que o Baileys envia nos eventos de sincronização.
// Só guarda quem tem algum nome/notify para a lista ser útil (evita números crus).
function persistContacts(accountId, rawList) {
  const mapped = (rawList || [])
    .map((c) => ({
      numero: jidToNumero(c.id),
      nome: c.name || c.notify || c.verifiedName || null,
      verificado: Boolean(c.verifiedName),
    }))
    .filter((c) => c.numero && c.nome);
  if (mapped.length === 0) return;
  contactsRepo
    .bulkUpsert(accountId, mapped)
    .then(() => accountsRepo.update(accountId, { ultimaSync: new Date() }).catch(() => {}))
    .catch(() => {});
}

// Socket Baileys ativo de uma conta (ou null). Usado para leituras ao vivo (grupos).
export function getSock(accountId) {
  if (!canTouchWhatsapp()) return null;
  if (!ownsAccountLocally(accountId)) return null;
  return sessions.get(accountId)?.sock || null;
}

// true só quando a conta tem sessão com a conexão JÁ aberta (pronta para enviar). Um socket que
// existe mas ainda está conectando (ou caiu) retorna false. O worker usa isto antes de disparar.
export function isConnected(accountId) {
  if (!canTouchWhatsapp()) return false;
  if (!ownsAccountLocally(accountId)) return false;
  return sessions.get(accountId)?.open === true;
}

// Busca ao vivo, via Baileys, os grupos em que a conta participa (aba Grupos do
// detalhe). Lança se a conta não estiver com sessão ativa. Atualiza ultimaSync.
export async function fetchGroups(accountId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const map = await sock.groupFetchAllParticipating();
  const groups = Object.values(map || {}).map((g) => ({
    waGroupId: g.id,
    nome: g.subject || '(sem nome)',
    participantes: Array.isArray(g.participants) ? g.participants.length : g.size || 0,
    descricao: g.desc || null,
  }));
  groups.sort((a, b) => a.nome.localeCompare(b.nome));
  await accountsRepo.update(accountId, { ultimaSync: new Date() }).catch(() => {});
  return groups;
}

// Busca (read-only) os participantes de todos os grupos em que a conta participa,
// numa única chamada (`groupFetchAllParticipating` já traz os participantes). Devolve
// um Map waGroupId -> { total, numeros } onde `numeros` são só os participantes com
// telefone real (@s.whatsapp.net) — grupos em modo LID podem expor menos números, o que
// é uma limitação do WhatsApp, não um bug. `total` é a contagem real do grupo.
export async function fetchParticipantsByAccount(accountId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const map = await sock.groupFetchAllParticipating();
  const out = new Map();
  for (const g of Object.values(map || {})) {
    const lista = Array.isArray(g.participants) ? g.participants : [];
    const participantes = [];
    let ignorados = 0;
    for (const p of lista) {
      const info = participantInfo(p);
      if (info) participantes.push(info);
      else ignorados += 1;
    }
    out.set(g.id, { total: lista.length, participantes, ignorados });
  }
  return out;
}

// Jids de TODOS os participantes de um grupo, para "marcar todos" (menção oculta). Usamos o
// `id` que o próprio groupMetadata devolve para cada participante — é o identificador válido
// naquele grupo (PN @s.whatsapp.net ou LID @lid) e é exatamente o que o mentionedJid espera para
// notificar o membro mesmo com o grupo silenciado. Requer a conta conectada; lança not_connected.
export async function fetchGroupParticipantJids(accountId, waGroupId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const meta = await sock.groupMetadata(waGroupId);
  const lista = Array.isArray(meta?.participants) ? meta.participants : [];
  return lista.map((p) => p.id).filter((id) => typeof id === 'string' && id.length > 0);
}

// Lê o link de convite ATUAL de um grupo (read-only — não revoga nem altera nada;
// `groupInviteCode` apenas retorna o código vigente). Requer a conta admin do grupo
// estar conectada. Devolve o link completo ou null.
export async function getInviteLink(accountId, waGroupId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const code = await sock.groupInviteCode(waGroupId);
  return code ? `https://chat.whatsapp.com/${code}` : null;
}

// Remove (expulsa) um participante de um grupo — MUTAÇÃO REAL (M6.6). Recebe o jid completo
// (PN @s.whatsapp.net ou LID @lid). Requer a conta admin conectada. `groupParticipantsUpdate`
// devolve [{ status }]; '200' = removido, '404' = já não estava no grupo (também sucesso).
export async function removeParticipant(accountId, waGroupId, jid) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const res = await sock.groupParticipantsUpdate(waGroupId, [jid], 'remove');
  const status = String(Array.isArray(res) ? res[0]?.status : '');
  if (status !== '200' && status !== '404') {
    const err = new Error(`status_${status || 'desconhecido'}`);
    err.code = 'remove_failed';
    throw err;
  }
  return { ok: true, status };
}

// Extrai de um jid (string) a chave de exibição + o jid completo. O jid pode vir como telefone
// real (PN, @s.whatsapp.net) ou como identificador do LID (@lid) — mesma situação dos
// participantes de grupo (ver participantInfo). Usado nas solicitações de entrada (M9.1) e no
// listener de atividades (M9.2).
function jidInfo(jid) {
  if (typeof jid !== 'string') return null;
  if (jid.endsWith('@s.whatsapp.net')) {
    const numero = jid.split('@')[0].split(':')[0];
    if (/^\d+$/.test(numero)) return { numero, jid: `${numero}@s.whatsapp.net` };
  }
  if (jid.endsWith('@lid')) {
    const id = jid.split('@')[0].split(':')[0];
    if (id) return { numero: id, jid: `${id}@lid` };
  }
  return null;
}

// Solicitação de entrada (attrs do Baileys, `{ jid, request_method, ... }`).
function requestInfo(attrs) {
  return jidInfo(attrs?.jid);
}

// Registra (em background) eventos de entrada/saída de participantes nos grupos da conta (M9.2 —
// aba Atividades). Só add/remove interessam (promover/rebaixar não são entrada/saída). O repo só
// grava se o grupo pertence a uma campanha DESTA conta (a dona), evitando duplicar entre contas.
function recordGroupActivity(accountId, ev) {
  const action = ev?.action;
  if (action !== 'add' && action !== 'remove') return;
  const tipo = action === 'add' ? 'join' : 'leave';
  const participantes = (ev.participants || []).map(jidInfo).filter(Boolean);
  if (participantes.length === 0) return;
  groupActivitiesRepo.recordEvent({ accountId, waGroupId: ev.id, tipo, participantes }).catch(() => {});
}

// Registra (em background) reações dos membros às NOSSAS mensagens, base do Leadscoring (M9.3).
// Cada item: { key: msg reagida (key.fromMe = era nossa), reaction: { key: quem reagiu, text: emoji } }.
// Só pontua reação a uma mensagem nossa (engajamento com o conteúdo disparado), com emoji presente
// (text vazio = reação removida) e por um participante que não seja a própria conta.
function recordReactions(accountId, reactions) {
  for (const item of reactions || []) {
    const alvo = item?.key; // mensagem reagida
    const autor = item?.reaction?.key; // mensagem que carrega a reação (quem reagiu)
    const emoji = item?.reaction?.text;
    if (!emoji) continue; // reação removida
    if (!alvo?.fromMe) continue; // só reações às nossas próprias mensagens
    if (autor?.fromMe) continue; // ignora a própria conta reagindo
    const waGroupId = autor?.remoteJid || alvo?.remoteJid;
    if (typeof waGroupId !== 'string' || !waGroupId.endsWith('@g.us')) continue; // só grupos
    const info = jidInfo(autor?.participant);
    if (!info) continue;
    leadEventsRepo.recordReaction({ accountId, waGroupId, numero: info.numero, jid: info.jid, emoji }).catch(() => {});
  }
}

// Lê (read-only) as solicitações de entrada pendentes de UM grupo (só faz sentido em grupos
// com "exigir aprovação para entrar" ligado; nos demais volta vazio). Requer a conta admin do
// grupo conectada. Devolve [{ numero, jid }] — `jid` é o endereço completo p/ aprovar/recusar.
export async function fetchEntryRequests(accountId, waGroupId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const lista = await sock.groupRequestParticipantsList(waGroupId);
  const out = [];
  for (const attrs of lista || []) {
    const info = requestInfo(attrs);
    if (info) out.push(info);
  }
  return out;
}

// Aprova ou recusa solicitações de entrada em um grupo — MUTAÇÃO REAL (aprovar = +1 membro no
// grupo, daí o pacing anti-banimento no worker). `jids`: endereços completos (PN/LID) exatamente
// como vieram na lista. `acao`: 'approve' | 'reject'. Requer a conta admin conectada. Devolve
// [{ jid, status }] do Baileys ('200' = ok; outro = código de erro daquele participante).
export async function updateEntryRequests(accountId, waGroupId, jids, acao) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const res = await sock.groupRequestParticipantsUpdate(waGroupId, jids, acao);
  return Array.isArray(res) ? res : [];
}

// Redefine (revoga) o link de convite de um grupo — MUTAÇÃO REAL: invalida o link
// atual e gera um novo. `groupRevokeInvite` já retorna o novo código. Requer a conta
// admin do grupo conectada. Devolve o novo link completo.
export async function revokeInviteLink(accountId, waGroupId) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const code = await sock.groupRevokeInvite(waGroupId);
  return code ? `https://chat.whatsapp.com/${code}` : null;
}

// Cria UM grupo real no WhatsApp pela conta (que já entra como admin/criadora).
// MUTAÇÃO REAL. Aplica as configurações pedidas (best-effort — um setting que falhe
// não invalida o grupo já criado) e lê o link de convite. Devolve os dados para persistir.
export async function createGroup(accountId, subject, { soAdminEnvia = false, aprovarEntrada = false } = {}) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  // participantes vazios: o grupo nasce só com a conta criadora.
  const meta = await sock.groupCreate(subject, []);
  const waGroupId = meta.id;
  if (soAdminEnvia) await sock.groupSettingUpdate(waGroupId, 'announcement').catch(() => {});
  if (aprovarEntrada) await sock.groupJoinApprovalMode(waGroupId, 'on').catch(() => {});
  let linkConvite = null;
  try {
    const code = await sock.groupInviteCode(waGroupId);
    linkConvite = code ? `https://chat.whatsapp.com/${code}` : null;
  } catch {
    // sem link agora — dá pra puxar depois em "Atualizar links"
  }
  return {
    waGroupId,
    nome: meta.subject || subject,
    participantes: Array.isArray(meta.participants) ? meta.participants.length : 1,
    linkConvite,
  };
}

// Abre ou fecha a interação de um grupo (quem pode enviar mensagem) — MUTAÇÃO REAL.
// `somenteAdmin=true` → só administradores enviam ('announcement'); `false` → todos enviam
// ('not_announcement'). Usado no fechamento automático após a janela de abertura (anti-banimento)
// e poderia ser reusado em outras telas. Requer a conta admin do grupo conectada.
export async function setSomenteAdminEnvia(accountId, waGroupId, somenteAdmin) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  await sock.groupSettingUpdate(waGroupId, somenteAdmin ? 'announcement' : 'not_announcement');
  return { ok: true };
}

// Aplica edições em lote a UM grupo real (M6.3) — MUTAÇÃO REAL. Recebe só os campos que
// o usuário escolheu alterar (os ausentes não mexem em nada). Cada alteração é best-effort:
// uma que falhe (ex.: conta não é admin, número fora do grupo) não impede as demais; o que
// deu certo e o que falhou são reportados por campo. Requer a conta admin do grupo conectada.
//   edits.nome            -> groupUpdateSubject
//   edits.descricao       -> groupUpdateDescription
//   edits.soAdminEnvia    -> groupSettingUpdate announcement | not_announcement
//   edits.soAdminEditaInfo-> groupSettingUpdate locked | unlocked
//   edits.aprovarEntrada  -> groupJoinApprovalMode on | off
//   edits.promover[]      -> groupParticipantsUpdate ... promote (números só dígitos)
export async function applyGroupEdits(accountId, waGroupId, edits = {}) {
  assertWhatsappLeader();
  const sock = getSock(accountId);
  if (!sock) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  await assertSessionOwner(accountId);
  const aplicadas = [];
  const falhas = [];
  async function tentar(campo, fn) {
    try {
      await fn();
      aplicadas.push(campo);
    } catch (e) {
      falhas.push({ campo, erro: e?.message || 'falhou' });
    }
  }

  if (typeof edits.nome === 'string') {
    await tentar('nome', () => sock.groupUpdateSubject(waGroupId, edits.nome));
  }
  if (typeof edits.descricao === 'string') {
    await tentar('descricao', () => sock.groupUpdateDescription(waGroupId, edits.descricao));
  }
  if (typeof edits.soAdminEnvia === 'boolean') {
    await tentar('soAdminEnvia', () => sock.groupSettingUpdate(waGroupId, edits.soAdminEnvia ? 'announcement' : 'not_announcement'));
  }
  if (typeof edits.soAdminEditaInfo === 'boolean') {
    await tentar('soAdminEditaInfo', () => sock.groupSettingUpdate(waGroupId, edits.soAdminEditaInfo ? 'locked' : 'unlocked'));
  }
  if (typeof edits.aprovarEntrada === 'boolean') {
    await tentar('aprovarEntrada', () => sock.groupJoinApprovalMode(waGroupId, edits.aprovarEntrada ? 'on' : 'off'));
  }
  if (typeof edits.mensagensTemporarias === 'number') {
    // segundos de expiração: 0 (desativadas), 86400 (24h), 604800 (7d), 7776000 (90d).
    await tentar('mensagensTemporarias', () => sock.groupToggleEphemeral(waGroupId, edits.mensagensTemporarias));
  }
  if (Array.isArray(edits.promover) && edits.promover.length > 0) {
    const jids = edits.promover.map((n) => `${n}@s.whatsapp.net`);
    // SEGURANÇA ANTI-BANIMENTO: por padrão NÃO adicionamos ninguém ao grupo. Adicionar
    // membros — sobretudo números que não têm a conta na agenda — é um dos maiores gatilhos
    // de banimento do WhatsApp (chegou a derrubar a sessão e banir um grupo em teste real).
    // Apenas PROMOVEMOS quem já é participante; quem não está no grupo não é promovido (vira
    // falha do campo 'promover', reportada). O add só ocorre se explicitamente pedido
    // (edits.adicionarSeFora === true, opt-in consciente), e deve ser usado com muita cautela.
    if (edits.adicionarSeFora === true) {
      await sock.groupParticipantsUpdate(waGroupId, jids, 'add').catch(() => {});
    }
    await tentar('promover', () => sock.groupParticipantsUpdate(waGroupId, jids, 'promote'));
  }

  return { aplicadas, falhas };
}

async function setStatus(accountId, status, extra = {}) {
  if (!(await isAccountOwnedByCurrentInstance(accountId))) return false;
  await accountsRepo.update(accountId, { status, ...extra }).catch(() => {});
  emit('account:status', { accountId, status, ...extra });
  return true;
}

export function isSessionActive(accountId) {
  return sessions.has(accountId);
}

// Inicia (ou reabre) a sessão Baileys de uma conta. Se já houver uma sessão ativa
// em memória, re-emite o último estado de pareamento (para o modal reaberto mostrar
// o QR/estado atual em vez de ficar preso "Iniciando sessão...").
export async function startSession(accountId, { manual = false } = {}) {
  assertWhatsappLeader();
  // Ação explícita do dono ("Iniciar sessão"): zera a espera acumulada e tenta agora. Reconexão
  // automática e watchdog chamam sem `manual` e continuam respeitando o backoff.
  if (manual) {
    reconnectAttempts.delete(accountId);
    nextAttemptAt.delete(accountId);
    clearReconnectTimer(accountId);
  }
  const ownership = await acquireAccountOwnership(accountId);
  if (!ownership.owned) {
    const err = new Error('account_owned_by_other');
    err.code = 'account_owned_by_other';
    err.ownerInstanceId = ownership.ownerInstanceId;
    err.leaseExpiresAt = ownership.leaseExpiresAt;
    throw err;
  }
  intentionalStops.delete(accountId);
  const existing = sessions.get(accountId);
  if (existing) {
    if (existing.lastPairing) emit('account:pairing', existing.lastPairing);
    return;
  }

  const sessionPath = sessionPathFor(accountId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const version = await resolveVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    printQRInTerminal: false,
    // Gera a imagem de preview do 1º link ao enviar mensagens (M7.3/M8.5).
    generateHighQualityLinkPreview: true,
  });

  // `open` = a conexão chegou a 'open' e ainda não caiu. Diferente de só existir um socket: logo
  // após startSession o socket existe mas ainda está em handshake (não dá para enviar). O worker
  // usa isso (isConnected) para não disparar numa conta que ainda não terminou de conectar.
  const entry = {
    sock,
    attempts: 0,
    lastPairing: null,
    hadConnected: false,
    open: false,
    // Conta já pareada? Decide a política de reconexão. Usa a identidade real gravada nas
    // credenciais (`me.id` = o telefone), NÃO o flag `creds.registered`, que é false até em conta
    // pareada e funcionando (ver comentário em hasStoredCreds).
    paired: Boolean(state.creds?.me?.id) || hasStoredCreds(accountId),
  };
  sessions.set(accountId, entry);
  clearReconnectTimer(accountId);

  if (await isAccountOwnedByCurrentInstance(accountId)) {
    await accountsRepo.update(accountId, { sessionPath }).catch(() => {});
  }

  sock.ev.on('creds.update', () => {
    queueCredsSave(accountId, entry, saveCreds);
  });

  // Sincronização de contatos (best-effort): o Baileys multi-device entrega contatos
  // no histórico inicial e em updates incrementais. Persistimos em background.
  sock.ev.on('contacts.upsert', (list) => guardOwnedEffect(accountId, () => persistContacts(accountId, list)));
  sock.ev.on('contacts.update', (list) => guardOwnedEffect(accountId, () => persistContacts(accountId, list)));
  sock.ev.on('messaging-history.set', ({ contacts }) => guardOwnedEffect(accountId, () => persistContacts(accountId, contacts)));

  // Atividades (M9.2): registra entradas/saídas de participantes nos grupos da campanha.
  sock.ev.on('group-participants.update', (ev) => guardOwnedEffect(accountId, () => recordGroupActivity(accountId, ev)));
  // Leadscoring (M9.3): registra reações dos membros às nossas mensagens nos grupos.
  sock.ev.on('messages.reaction', (reactions) => guardOwnedEffect(accountId, () => recordReactions(accountId, reactions)));

  sock.ev.on('connection.update', async (update) => {
    if (!canTouchWhatsapp()) {
      if (update.connection === 'close') sessions.delete(accountId);
      return;
    }
    if (!(await ensureLiveOwnership(accountId, entry))) return;

    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      entry.attempts += 1;
      const dataUrl = await QRCode.toDataURL(qr);
      logConnection(accountId, 'qr', { attempts: entry.attempts });
      emitPairing(accountId, { accountId, stage: 'qr', qr: dataUrl, qrRaw: qr, attempt: entry.attempts });
      await setStatus(accountId, 'no_session');
      return;
    }

    if (connection === 'connecting') {
      logConnection(accountId, 'connecting');
      // QR já escaneado no celular, aguardando o WhatsApp confirmar o pareamento.
      emitPairing(accountId, { accountId, stage: 'connecting' });
      return;
    }

    if (connection === 'open') {
      entry.attempts = 0;
      entry.hadConnected = true;
      entry.open = true;
      clearReconnectTimer(accountId);
      reconnectAttempts.delete(accountId);
      nextAttemptAt.delete(accountId);
      const numero = sock.user?.id?.split(':')[0] || sock.user?.id || null;
      logConnection(accountId, 'open');
      await setStatus(accountId, 'connected', numero ? { telefone: numero } : {});
      emitPairing(accountId, { accountId, stage: 'connected' });
      emit('account:connected', { accountId });
      return;
    }

    if (connection === 'close') {
      sessions.delete(accountId);
      clearReconnectTimer(accountId);

      const { statusCode, motivo } = disconnectInfo(lastDisconnect);
      // `deliberado` distingue queda real de parada nossa (Desconectar, deploy, troca de líder).
      // O monitor de alertas usa isso para não transformar todo deploy em alerta falso.
      const deliberado = intentionalStops.has(accountId);
      logConnection(accountId, 'close', { statusCode, motivo, deliberado });

      if (intentionalStops.delete(accountId)) {
        // stopSession() já tratou o status/credenciais — não reconectar.
        reconnectAttempts.delete(accountId);
        return;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        // ÚNICO caso em que apagamos a sessão: 401 = o aparelho desvinculou este dispositivo.
        // É uma declaração inequívoca do WhatsApp, e nenhuma reconexão recupera.
        reconnectAttempts.delete(accountId);
        nextAttemptAt.delete(accountId);
        await rm(sessionPath, { recursive: true, force: true });
        await setStatus(accountId, 'no_session', { sessionPath: null });
        // Registrado como estágio próprio: é o único caso que exige o dono presencialmente (QR
        // novo), então precisa virar alerta crítico e não se confundir com uma queda comum.
        logConnection(accountId, 'logged_out', { statusCode, motivo });
        await releaseAccountOwnership(accountId).catch(() => {});
        return;
      }

      // badSession (500) NÃO apaga mais a sessão. O Baileys classifica como `badSession` também
      // erros genéricos de stream, então um erro passageiro estava DESTRUINDO uma sessão boa e
      // exigindo novo QR — a causa mais provável das quedas crônicas das contas que "caíam a cada
      // dois ou três dias". Agora é tratado como queda recuperável, com espera longa. Se a
      // credencial estiver mesmo corrompida, a conta fica visível como desconectada e o dono
      // reparea quando quiser; nada é apagado sem ordem dele.

      if (statusCode === DisconnectReason.connectionReplaced) {
        // Outra conexão assumiu esta sessão. Solta a posse para não brigar, mas aplica um
        // resfriamento em vez de desistir para sempre: o watchdog respeita `nextAttemptAt` e só
        // tenta retomar depois disso, então a conta se recupera sozinha se a outra conexão sumir.
        await setStatus(accountId, 'disconnected');
        reconnectAttempts.delete(accountId);
        nextAttemptAt.set(accountId, Date.now() + 5 * 60 * 1000);
        logConnection(accountId, 'posse_solta', { statusCode, motivo, retomarEmMs: 5 * 60 * 1000 });
        // Avisa um modal de conexão aberto para não ficar preso em "Iniciando sessão...".
        // É só notificação: não altera a política de reconexão.
        emitPairing(accountId, { accountId, stage: 'retrying', statusCode, motivo });
        await releaseAccountOwnership(accountId).catch(() => {});
        return;
      }

      // `paired` reavaliado no disco a cada queda: é a única fonte de verdade confiável.
      const paired = entry.paired || hasStoredCreds(accountId);

      if (!paired) {
        // Conta que NUNCA foi pareada (não há credencial em disco): está no fluxo de QR. Reabre
        // rápido para renovar o código, mas com teto, para não gerar QR eternamente se ninguém
        // estiver escaneando. Como não há sessão, `no_session` aqui é a verdade, não um castigo.
        const tentativas = (reconnectAttempts.get(accountId) || 0) + 1;
        reconnectAttempts.set(accountId, tentativas);
        if (tentativas > MAX_TENTATIVAS_QR) {
          reconnectAttempts.delete(accountId);
          nextAttemptAt.delete(accountId);
          await setStatus(accountId, 'no_session');
          logConnection(accountId, 'pairing_stopped', { statusCode, motivo, tentativas });
          await releaseAccountOwnership(accountId).catch(() => {});
          return;
        }
        await setStatus(accountId, 'no_session');
        logConnection(accountId, 'reconnect_scheduled', { motivo, statusCode, nextDelayMs: 2000 });
        scheduleReconnect(accountId, 2000, motivo);
        return;
      }

      // Conta PAREADA: nunca desiste. Fica `disconnected` (nunca `no_session`, que exigiria QR) e
      // tenta de novo para sempre, com espera crescente conforme o motivo da queda. É isso que
      // sustenta o cenário de ficar uma semana ausente: qualquer queda se resolve sozinha.
      await setStatus(accountId, 'disconnected');

      // A espera cresce a cada tentativa consecutiva e depende do motivo: recusa do WhatsApp
      // (405/403) usa a escada longa; queda transitória de rede usa a curta. O contador zera
      // assim que a conta conecta.
      const delay = nextBackoff(accountId, statusCode);
      logConnection(accountId, 'reconnect_scheduled', {
        motivo,
        statusCode,
        nextDelayMs: delay,
      });
      scheduleReconnect(accountId, delay, motivo);
      // Conta pareada que não subiu a conexão: avisa um modal de conexão aberto (ele nunca
      // recebe QR, pois a conta já é pareada, e sem isto ficaria preso em "Iniciando sessão...").
      // É só notificação: a reconexão em segundo plano segue pelo backoff acima, intacta.
      emitPairing(accountId, { accountId, stage: 'retrying', statusCode, motivo });
    }
  });
}

// Encerra a sessão em memória. `wipe` também apaga as credenciais salvas em disco
// (equivalente a "Finalizar Sessão"); sem `wipe` é só "Desconectar" (mantém credenciais
// para reconectar sem novo QR).
export async function stopSession(accountId, { wipe = false } = {}) {
  assertWhatsappLeader();
  const ownership = await acquireAccountOwnership(accountId);
  if (!ownership.owned) {
    const err = new Error('account_owned_by_other');
    err.code = 'account_owned_by_other';
    err.ownerInstanceId = ownership.ownerInstanceId;
    err.leaseExpiresAt = ownership.leaseExpiresAt;
    throw err;
  }
  // Parada deliberada (Desconectar/Finalizar): cancela qualquer tentativa pendente de retomada
  // por connectionReplaced para a conta não voltar sozinha contra a vontade do dono.
  clearReconnectTimer(accountId);
  reconnectAttempts.delete(accountId);
  nextAttemptAt.delete(accountId);
  const entry = sessions.get(accountId);
  if (entry) {
    sessions.delete(accountId);
    intentionalStops.add(accountId);
    try {
      entry.sock.end(undefined);
    } catch {
      // socket já pode estar fechado
    }
  }

  if (wipe) {
    await rm(sessionPathFor(accountId), { recursive: true, force: true });
    await setStatus(accountId, 'no_session', { sessionPath: null });
  } else {
    await setStatus(accountId, 'disconnected');
  }
  await releaseAccountOwnership(accountId).catch(() => {});
}

// Encerra todos os sockets Baileys no desligamento do processo. Sem isso, as conexões
// WebSocket abertas seguram o event loop e o shutdown gracioso (SIGTERM em restart/deploy)
// fica preso. Não mexe no banco nem agenda reconexão — é só liberar os handles.
export function shutdownSessions({ silent = false } = {}) {
  clearAllReconnectTimers();
  for (const [accountId, entry] of sessions) {
    try {
      if (silent) intentionalStops.add(accountId);
      entry.sock.end(undefined);
    } catch {
      // socket já pode estar fechado
    }
  }
  sessions.clear();
}

// SUPERVISOR DE CONEXÕES (watchdog). Roda no boot e a cada 30s. É a rede de segurança final e
// trata cada conta de forma independente: para toda conta com credencial em disco, garante que ela
// esteja conectada ou com uma tentativa agendada. Nenhuma outra parte do sistema pode deixar uma
// conta pareada permanentemente parada — foi exatamente isso que aconteceu em 29/07/2026, quando
// um estado errado no banco (`no_session`) desligou as 6 contas de vez.
//
// Regras que tornam este laço seguro:
// - DISCO é a fonte de verdade (`hasStoredCreds`), nunca o status do banco.
// - Respeita `nextAttemptAt`, então jamais antecipa uma espera nem vira um martelo.
// - Corrige o banco quando ele contradiz o disco (auto-cura de estado incoerente).
export async function restoreSessions() {
  assertWhatsappLeader();
  if (restoreRunning) return;
  restoreRunning = true;
  try {
    const accounts = await accountsRepo.list();
    for (const account of accounts) {
      // Já tem socket vivo, reconexão agendada, ou foi parada deliberadamente pelo dono.
      if (sessions.has(account.id) || reconnectTimers.has(account.id)) continue;
      if (intentionalStops.has(account.id)) continue;
      // Sem credencial em disco = conta realmente sem sessão. Só volta por ação do dono (QR).
      if (!hasStoredCreds(account.id)) continue;
      // Ainda dentro da espera calculada pelo backoff: não antecipar.
      if ((nextAttemptAt.get(account.id) || 0) > Date.now()) continue;

      // Auto-cura: há credencial em disco, então `no_session`/`sessionPath` vazio no banco é
      // estado incoerente (deixado por bug ou por uma parada anômala). Corrige e reconecta, sem
      // exigir novo QR do dono.
      if (account.status === 'no_session' || !account.sessionPath) {
        await accountsRepo
          .update(account.id, { status: 'disconnected', sessionPath: sessionPathFor(account.id) })
          .catch(() => {});
        logConnection(account.id, 'estado_corrigido', {
          de: account.status,
          para: 'disconnected',
          motivo: 'credenciais_presentes_em_disco',
        });
      }

      try {
        await startSession(account.id);
      } catch (err) {
        if (err?.code === 'account_owned_by_other') {
          logConnection(account.id, 'restore_skipped', {
            motivo: 'account_owned_by_other',
            ownerInstanceId: err.ownerInstanceId || null,
            leaseExpiresAt: err.leaseExpiresAt || null,
          });
        } else {
          logConnection(account.id, 'restore_failed', { error: safeError(err) });
        }
      }
    }
  } finally {
    restoreRunning = false;
  }
}

export function startSessionRestoreLoop() {
  if (restoreTimer) return;
  restoreSessions().catch(() => {});
  restoreTimer = setInterval(() => {
    if (!canTouchWhatsapp()) return;
    restoreSessions().catch(() => {});
  }, 30000);
  restoreTimer.unref?.();
}

export function stopSessionRestoreLoop() {
  if (restoreTimer) clearInterval(restoreTimer);
  restoreTimer = null;
}
