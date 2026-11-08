import { EXTERNAL_INTEGRATIONS_ENABLED, requireExternalIntegration } from '../portfolio.js';
import { AUTHENTICATED_ROOM } from '../security.js';
import { prisma } from '../db.js';
import { scheduledSendsRepo, removalsRepo, groupEditsRepo, groupsRepo, entryRequestsRepo, campaignsRepo } from '../repositories/index.js';
import { observarDisparo } from '../alerts/monitor.js';
import sharp from 'sharp';
import { spin } from '../utils/spintax.js';
import { buildWaLinkPreview } from '../utils/linkPreview.js';
import { localFilePath, mimePorExt } from '../uploads.js';
import { getSock, isConnected, fetchGroupParticipantJids, removeParticipant, applyGroupEdits, updateEntryRequests, setSomenteAdminEnvia } from './manager.js';
import { isLeaderProcess } from '../leadership.js';
import { instanceId, safeError } from '../runtime.js';

// Perfis de velocidade (CLAUDE.md §6): intervalos aleatórios entre grupos.
// Quanto mais lento, menor o risco de banimento. Custom usa o que vier.
export const SPEED_PROFILES = {
  rapida: { min: 90, max: 180 },
  normal: { min: 140, max: 460 },
  lenta: { min: 300, max: 720 },
  ultralenta: { min: 600, max: 1200 },
};

export function resolveProfile(perfil, customMin, customMax) {
  if (perfil === 'custom') {
    const min = Math.max(60, Number(customMin) || SPEED_PROFILES.normal.min);
    const max = Math.max(min, Number(customMax) || SPEED_PROFILES.normal.max);
    return { min, max };
  }
  return SPEED_PROFILES[perfil] || SPEED_PROFILES.normal;
}

export const SEND_PACKAGE = {
  tamanho: 15,
  pausaMin: 30 * 60,
  pausaMax: 45 * 60,
  pausaCurtaContaMin: 5 * 60,
  pausaCurtaContaMax: 10 * 60,
  pausaFalhaContaMin: 45 * 60,
  pausaFalhaContaMax: 60 * 60,
};

export function estimateSendDuration({ totalGrupos, contas, perfilVelocidade, intervaloMin, intervaloMax }) {
  const total = Math.max(0, Number(totalGrupos) || 0);
  const nContas = Math.max(1, Number(contas) || 1);
  const { min, max } = resolveProfile(perfilVelocidade, intervaloMin, intervaloMax);
  const base = Math.floor(total / nContas);
  const extra = total % nContas;
  const porConta = Array.from({ length: nContas }, (_, i) => base + (i < extra ? 1 : 0));
  const estimarConta = (qtd, intervalo) => {
    if (qtd <= 1) return 0;
    const intervalos = qtd - 1;
    const pausas = Math.floor((qtd - 1) / SEND_PACKAGE.tamanho);
    return intervalos * intervalo + pausas * (intervalo === min ? SEND_PACKAGE.pausaMin : SEND_PACKAGE.pausaMax);
  };
  return {
    totalGrupos: total,
    contas: nContas,
    porConta,
    intervaloMin: min,
    intervaloMax: max,
    pacoteTamanho: SEND_PACKAGE.tamanho,
    pausaPacoteMin: SEND_PACKAGE.pausaMin,
    pausaPacoteMax: SEND_PACKAGE.pausaMax,
    segundosMin: Math.max(0, ...porConta.map((qtd) => estimarConta(qtd, min))),
    segundosMax: Math.max(0, ...porConta.map((qtd) => estimarConta(qtd, max))),
  };
}

// Distribui grupos aleatória e uniformemente entre as contas (anti-banimento):
// embaralha e reparte em rodízio. Ex.: 10 grupos / 3 contas → 4,3,3.
// Retorna Map accountId -> [groupIds] (só contas que receberam ao menos 1 grupo).
export function distribuirGrupos(groupIds, accountIds) {
  const embaralhados = [...groupIds].sort(() => Math.random() - 0.5);
  const mapa = new Map();
  embaralhados.forEach((g, i) => {
    const acc = accountIds[i % accountIds.length];
    if (!mapa.has(acc)) mapa.set(acc, []);
    mapa.get(acc).push(g);
  });
  return mapa;
}

function randomInterval(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let workerGeneration = 0;

function workerCanRun(generation) {
  return isLeaderProcess() && generation === workerGeneration;
}

// Teto de segurança para uma operação do Baileys que pode TRAVAR (socket meio-aberto: o TCP
// morre sem o WebSocket perceber, então o sendMessage/groupMetadata fica esperando um ack que
// nunca chega). Sem isto, o disparo inteiro congela naquele grupo. Com isto, a operação vira
// erro e o loop segue para o próximo grupo. Um envio normal do WhatsApp leva poucos segundos.
const OP_TIMEOUT_MS = 60000;
function withTimeout(promise, ms, label) {
  let t;
  const limite = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label || 'timeout')), ms);
    if (t.unref) t.unref();
  });
  return Promise.race([promise, limite]).finally(() => clearTimeout(t));
}

const TARGET_TRANSIENT_RETRIES = 2;
const TARGET_RECONNECT_WAIT_MS = 90000;
const TARGET_RETRY_SETTLE_MS = 2000;

let io = null;
let logger = null;
export function attachWorkerIO(ioServer) {
  io = ioServer;
}
export function attachWorkerLogger(appLogger) {
  logger = appLogger;
}
function emit(event, payload) {
  if (io) io.to(AUTHENTICATED_ROOM).emit(event, payload);
}
function logWorkerError(event, error, extra = {}) {
  if (!logger) return;
  logger.error(
    {
      event,
      error: safeError(error),
      instanceId,
      pid: process.pid,
      ts: new Date().toISOString(),
      ...extra,
    },
    'Falha no worker de disparos',
  );
}

// Avisa o dono quando um disparo agendado termina mal. Chamado nos pontos em que o disparo fecha:
// um agendamento que falha em silêncio é exatamente o que aconteceu em 29/07/2026. Busca o nome da
// campanha só aqui (caminho raro) para a mensagem dizer o que falhou, não um id.
async function alertarDisparoFinalizado(send, { status, total = 0, ok = 0, erro = null }) {
  try {
    const campanha = await campaignsRepo
      .get(send.campaignId)
      .then((c) => c?.nome || send.campaignId)
      .catch(() => send.campaignId);
    observarDisparo({ sendId: send.id, campanha, accountId: send.accountId, status, total, ok, erro });
  } catch {
    // alerta é acessório: nunca pode atrapalhar o disparo
  }
}

function isUnstableSendError(error) {
  const msg = String(error || '').toLowerCase();
  return msg === 'not_connected'
    || msg === 'account_offline'
    || msg === 'connection_closed'
    || msg === 'connection_lost'
    || msg === 'restart_required'
    || msg === 'stream_error'
    || msg === 'send_timeout'
    || msg.includes('timed out')
    || msg.includes('timeout');
}

function normalizeSendError(err) {
  const statusCode = err?.output?.statusCode ?? err?.statusCode ?? err?.status ?? null;
  const raw = String(err?.message || err?.name || '').trim();
  const msg = raw.toLowerCase();
  if (statusCode === 428 || msg.includes('connection closed')) return 'connection_closed';
  if (statusCode === 515 || msg.includes('restart required')) return 'restart_required';
  if (msg.includes('connection lost')) return 'connection_lost';
  if (msg.includes('stream errored') || msg.includes('stream error')) return 'stream_error';
  if (msg.includes('timed out') || msg.includes('timeout')) return 'send_timeout';
  return raw || 'send_failed';
}

function canRetryTarget(error, blocosEnviados = 0) {
  if (blocosEnviados > 0) return false;
  const msg = String(error || '').toLowerCase();
  return msg === 'not_connected'
    || msg === 'connection_closed'
    || msg === 'connection_lost'
    || msg === 'restart_required'
    || msg === 'stream_error';
}

async function waitForAccountConnection(accountId, generation, timeoutMs = TARGET_RECONNECT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (workerCanRun(generation) && Date.now() < deadline) {
    if (isConnected(accountId)) return true;
    await sleep(1000);
  }
  return isConnected(accountId);
}

async function getAccountSendPause(accountId) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { envioPausadoAte: true },
  });
  const until = account?.envioPausadoAte ? new Date(account.envioPausadoAte) : null;
  if (!until || until.getTime() <= Date.now()) return null;
  return until;
}

async function pauseAccountSending(accountId, minSeconds, maxSeconds, reason) {
  const seconds = randomInterval(minSeconds, maxSeconds);
  const until = new Date(Date.now() + seconds * 1000);
  await prisma.account.update({
    where: { id: accountId },
    data: {
      envioPausadoAte: until,
      envioFalhasConsecutivas: { increment: 1 },
      envioUltimaFalhaEm: new Date(),
    },
  }).catch(() => {});
  emit('account:send-pause', { accountId, until: until.toISOString(), reason });
  return until;
}

async function resetAccountSendingHealth(accountId) {
  await prisma.account.update({
    where: { id: accountId },
    data: {
      envioPausadoAte: null,
      envioFalhasConsecutivas: 0,
      envioUltimaFalhaEm: null,
    },
  }).catch(() => {});
}

// jid do próprio número da conta (chat pessoal) — alvo seguro para testes.
export function selfJidFor(account) {
  const digits = String(account?.telefone || '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

// Fonte de mídia para o Baileys: arquivo local enviado (caminho no disco) ou URL externa. O
// Baileys lê de `{ url }` tanto de http quanto de caminho de arquivo local (createReadStream).
function fonteMidia(midia) {
  const local = localFilePath(midia);
  return { url: local || midia };
}

// Converte a mídia (local ou URL) em um WEBP 512x512 para enviar como sticker.
async function stickerBuffer(midia) {
  const local = localFilePath(midia);
  const input = local || Buffer.from(await (await fetch(midia)).arrayBuffer());
  return sharp(input)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toBuffer();
}

// Monta o conteúdo do sendMessage conforme o tipo de mídia (Leva 2). image/video/gif/document
// levam o texto como legenda; audio e sticker vão sozinhos.
async function montarConteudoMidia(message, texto) {
  const fonte = fonteMidia(message.midia);
  const legenda = texto || undefined;
  switch (message.midiaTipo) {
    case 'video':
      return { video: fonte, caption: legenda };
    case 'gif':
      return { video: fonte, gifPlayback: true, caption: legenda };
    case 'audio':
      return { audio: fonte, mimetype: mimePorExt(message.midiaNome || message.midia) };
    case 'document':
      return { document: fonte, fileName: message.midiaNome || 'arquivo', mimetype: mimePorExt(message.midiaNome || message.midia), caption: legenda };
    case 'sticker':
      return { sticker: await stickerBuffer(message.midia) };
    case 'image':
    default:
      return { image: fonte, caption: legenda };
  }
}

// Monta um vCard simples (nome + telefone) para enviar um contato.
function montarVcard(nome, numero) {
  const digits = String(numero).replace(/\D/g, '');
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${nome}\nTEL;type=CELL;type=VOICE;waid=${digits}:+${digits}\nEND:VCARD`;
}

// Envia UM bloco para um jid (grupo ou pessoa). Texto/mídia aplicam Spintax e preview de link;
// enquete (poll) e contato (vCard) têm seus próprios formatos. NÃO espera intervalo — quem chama controla.
// `mentions` (opcional): lista de jids para "marcar todos" (menção oculta) — vai no mentionedJid da
// mensagem e notifica os membros mesmo com o grupo silenciado, sem escrever "@todos" no texto.
export async function sendToJid(accountId, jid, message, mentions) {
  requireExternalIntegration();
  const sock = getSock(accountId);
  if (!sock) return { ok: false, error: 'not_connected' };
  try {
    let content;
    let amostra = '';
    if (message.tipo === 'enquete' && Array.isArray(message.opcoes) && message.opcoes.length >= 2) {
      const pergunta = spin(message.pergunta || '');
      content = { poll: { name: pergunta, values: message.opcoes, selectableCount: message.multiplas ? message.opcoes.length : 1 } };
      amostra = pergunta;
    } else if (message.tipo === 'contato' && message.numero) {
      content = { contacts: { displayName: message.nome, contacts: [{ vcard: montarVcard(message.nome, message.numero) }] } };
      amostra = message.nome;
    } else {
      const texto = spin(message.conteudo);
      amostra = texto;
      if (message.midia) {
        content = await montarConteudoMidia(message, texto);
      } else if (message.usarPreviewLink === false) {
        content = { text: texto, linkPreview: null };
      } else {
        // Geramos o preview de link nós mesmos (OG + thumbnail via sharp) e o passamos explícito.
        // Definir `linkPreview` (objeto ou null) evita que o Baileys tente a lib link-preview-js.
        const preview = await buildWaLinkPreview(texto).catch(() => null);
        content = { text: texto, linkPreview: preview || null };
      }
    }
    // Marcar todos (menção oculta): o Baileys move `mentions` para o mentionedJid do contextInfo.
    // Aplicado a texto e mídia; enquete/contato têm formato próprio e não são marcados.
    if (Array.isArray(mentions) && mentions.length > 0 && content && !content.poll && !content.contacts) {
      content = { ...content, mentions };
    }
    await withTimeout(sock.sendMessage(jid, content), OP_TIMEOUT_MS, 'send_timeout');
    return { ok: true, sample: amostra };
  } catch (err) {
    return { ok: false, error: normalizeSendError(err) };
  }
}

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

// Tempo de espera (segundos) ANTES de enviar um bloco a partir do 2º, imitando o tempo humano de
// digitar/gravar o conteúdo. Proporcional à quantidade de caracteres + aleatório (nunca fixo):
// mensagem curta espera poucos segundos, longa espera mais. Áudio simula gravação; mídia sem
// legenda / enquete / contato usam uma janela curta própria. Teto de 30s para um bloco enorme não
// travar o disparo. Com os 5 blocos cheios o total por grupo fica em torno de 1 min.
function blocoDelaySegundos(bloco) {
  if (bloco.tipo === 'enquete' || bloco.tipo === 'contato') return randFloat(4, 9);
  if (bloco.midiaTipo === 'audio') return randFloat(5, 14); // "gravando áudio…"
  const chars = String(bloco.conteudo || '').length;
  if (chars === 0) return randFloat(4, 9); // mídia sem legenda
  const bruto = randFloat(3, 6) + chars * randFloat(0.04, 0.08);
  return Math.min(30, Math.max(5, bruto));
}

// Presença a emitir enquanto o bloco é "preparado": áudio vira "gravando áudio…", o resto
// "digitando…". Espelha a interação humana em tempo real que o WhatsApp/Meta espera.
function presencaDoBloco(bloco) {
  if (bloco.tipo === 'enquete' || bloco.tipo === 'contato') return 'composing';
  return bloco.midiaTipo === 'audio' ? 'recording' : 'composing';
}

// Emite um estado de presença no chat/grupo. Acessório: qualquer erro é engolido, presença jamais
// pode quebrar um envio. Não mexe na conexão — é só uma mensagem de protocolo do próprio socket.
async function enviarPresenca(accountId, jid, tipo) {
  try {
    const sock = getSock(accountId);
    if (sock) await sock.sendPresenceUpdate(tipo, jid);
  } catch {
    // presença é enfeite anti-banimento; nunca atrapalha o disparo
  }
}

// Espera `segundos` mantendo a presença viva (o indicador "digitando…/gravando…" some sozinho em
// poucos segundos, então reemitimos a cada ~5s) e sinaliza `paused` ao final, logo antes do envio.
async function esperarComPresenca(accountId, jid, segundos, presenca) {
  const totalMs = Math.round(segundos * 1000);
  const passoMs = 5000;
  let decorrido = 0;
  await enviarPresenca(accountId, jid, presenca);
  while (decorrido < totalMs) {
    const fatia = Math.min(passoMs, totalMs - decorrido);
    await sleep(fatia);
    decorrido += fatia;
    if (decorrido < totalMs) await enviarPresenca(accountId, jid, presenca);
  }
  await enviarPresenca(accountId, jid, 'paused');
}

// Blocos de uma mensagem (a partir do registro do banco). Mensagem legada (sem `blocos`) vira
// um único bloco derivado de conteudo/midia.
function blocosDaMensagem(message) {
  let blocos = [];
  try {
    blocos = message.blocos ? JSON.parse(message.blocos) : [];
  } catch {
    blocos = [];
  }
  if (!Array.isArray(blocos) || blocos.length === 0) {
    blocos = [{
      conteudo: message.conteudo || '',
      midia: message.midia || null,
      midiaTipo: message.midiaTipo || null,
      midiaNome: message.midiaNome || null,
      usarPreviewLink: message.usarPreviewLink !== false,
    }];
  }
  return blocos;
}

// Envia todos os blocos de uma mensagem a um jid, em sequência e na ordem. O 1º bloco é
// instantâneo; a partir do 2º há uma espera proporcional ao tamanho do conteúdo, com "digitando…/
// gravando áudio…" durante a espera, imitando um humano. Falha no primeiro bloco que não enviar
// (os anteriores já foram). "Marcar todos" é aplicado SÓ no 1º bloco: repetir a menção em cada
// bloco notificaria todo o grupo várias vezes (sinal forte de spam).
export async function enviarBlocos(accountId, jid, message, mentions) {
  const blocos = blocosDaMensagem(message);
  let amostra = '';
  for (let b = 0; b < blocos.length; b++) {
    if (b > 0) {
      await esperarComPresenca(accountId, jid, blocoDelaySegundos(blocos[b]), presencaDoBloco(blocos[b]));
    }
    const mencaoDoBloco = b === 0 ? mentions : undefined;
    const r = await sendToJid(accountId, jid, blocos[b], mencaoDoBloco);
    if (!r.ok) return { ok: false, error: r.error, blocosEnviados: b };
    amostra = r.sample || amostra;
  }
  return { ok: true, sample: amostra, blocosEnviados: blocos.length };
}

async function enviarAlvoComRetentativa(send, target, mentions, generation) {
  let last = null;
  for (let tentativa = 0; tentativa <= TARGET_TRANSIENT_RETRIES; tentativa += 1) {
    if (!workerCanRun(generation)) return last || { ok: false, error: 'worker_stopped', blocosEnviados: 0 };
    const r = await enviarBlocos(send.accountId, target.waGroupId, send.message, mentions);
    if (r.ok) return tentativa > 0 ? { ...r, retried: true, retryCount: tentativa } : r;
    last = r;
    if (tentativa >= TARGET_TRANSIENT_RETRIES || !canRetryTarget(r.error, r.blocosEnviados)) return r;

    emit('send:retry', {
      sendId: send.id,
      accountId: send.accountId,
      targetId: target.id,
      nome: target.nomeGrupo,
      error: r.error,
      attempt: tentativa + 1,
      waitMs: TARGET_RECONNECT_WAIT_MS,
    });
    const voltou = await waitForAccountConnection(send.accountId, generation);
    if (!voltou) return { ok: false, error: 'account_offline', blocosEnviados: 0, retryCount: tentativa + 1 };
    await sleep(TARGET_RETRY_SETTLE_MS);
  }
  return last || { ok: false, error: 'send_failed', blocosEnviados: 0 };
}

// Processa um disparo: envia para cada grupo com intervalo aleatório e emite progresso.
export async function processSend(sendId, generation = workerGeneration) {
  if (!workerCanRun(generation)) return;
  const send = await scheduledSendsRepo.claimSendForProcessing(sendId);
  if (!send) return;

  try {
    await scheduledSendsRepo.ensureTargets(send);
    emit('send:status', { sendId, status: 'processing' });

    const allTargets = await scheduledSendsRepo.listTargets(sendId);
    const total = allTargets.length;
    // Piso de velocidade: mensagem com 2+ blocos já leva mais tempo por grupo (espera entre blocos),
    // então o perfil mais agressivo (Rápida) entre grupos é rebaixado para Normal. Só afeta o
    // intervalo ENTRE grupos; o pacing dentro do grupo é a espera por bloco.
    const nBlocos = blocosDaMensagem(send.message).length;
    const perfilEfetivo = send.perfilVelocidade === 'rapida' && nBlocos >= 2 ? 'normal' : send.perfilVelocidade;
    const { min, max } = resolveProfile(perfilEfetivo, send.intervaloMin, send.intervaloMax);
    let processadosNoPacote = 0;

    while (workerCanRun(generation)) {
      const tgt = await scheduledSendsRepo.claimNextTarget(sendId);
      if (!tgt) break;
      processadosNoPacote += 1;

      if (!workerCanRun(generation)) return;
      // Marcar todos: busca os jids dos participantes DESTE grupo (varia por grupo). Se a busca
      // falhar, envia sem menção — melhor entregar a mensagem do que abortar o disparo.
      let mentions;
      if (send.marcarTodos) {
        mentions = await withTimeout(fetchGroupParticipantJids(send.accountId, tgt.waGroupId), OP_TIMEOUT_MS, 'meta_timeout').catch(() => []);
      }
      const r = await enviarAlvoComRetentativa(send, tgt, mentions, generation);
      await scheduledSendsRepo.setTargetFinal(tgt.id, r.ok ? 'sent' : 'failed', {
        erro: r.ok ? null : (r.error || 'send_failed'),
        resultado: r.ok ? { sample: r.sample || null, retried: Boolean(r.retried), retryCount: r.retryCount || 0 } : null,
      });
      const resumo = await scheduledSendsRepo.finishIfTargetsComplete(sendId);
      const done = resumo.resultado.length;
      emit('send:progress', { sendId, done, total, nome: tgt.nomeGrupo, ok: r.ok });

      if (!r.ok && isUnstableSendError(r.error)) {
        // Circuit breaker por conta: se a sessão caiu no meio, não insistimos nos próximos grupos
        // desta conta. O restante aberto vira falha explícita e o dono decide reprocessar depois.
        await pauseAccountSending(
          send.accountId,
          SEND_PACKAGE.pausaFalhaContaMin,
          SEND_PACKAGE.pausaFalhaContaMax,
          r.error,
        );
        await scheduledSendsRepo.failOpenTargets(sendId, 'account_offline').catch(() => {});
        const fimConta = await scheduledSendsRepo.finishIfTargetsComplete(sendId).catch(() => null);
        if (fimConta?.complete) {
          emit('send:status', { sendId, status: fimConta.status, total, ok: fimConta.okCount });
          await alertarDisparoFinalizado(send, { status: fimConta.status, total, ok: fimConta.okCount, erro: r.error });
        }
        return;
      }
      if (r.ok) await resetAccountSendingHealth(send.accountId);

      const pendentes = await scheduledSendsRepo.countPendingTargets(sendId).catch(() => 0);
      if (pendentes > 0) {
        const fimDePacote = processadosNoPacote > 0 && processadosNoPacote % SEND_PACKAGE.tamanho === 0;
        const espera = fimDePacote
          ? randomInterval(SEND_PACKAGE.pausaMin, SEND_PACKAGE.pausaMax)
          : randomInterval(min, max);
        emit('send:pause', {
          sendId,
          accountId: send.accountId,
          seconds: espera,
          kind: fimDePacote ? 'package' : 'interval',
        });
        await sleep(espera * 1000);
      }
    }

    const fim = await scheduledSendsRepo.finishIfTargetsComplete(sendId);
    if (fim.complete) {
      emit('send:status', { sendId, status: fim.status, total, ok: fim.okCount });
      await alertarDisparoFinalizado(send, { status: fim.status, total, ok: fim.okCount });
    }
  } catch (err) {
    logWorkerError('send_processing_unexpected_error', err, {
      sendId,
      accountId: send.accountId,
      campaignId: send.campaignId,
    });
    if (isLeaderProcess()) {
      await scheduledSendsRepo.requeueProcessingSend(sendId).catch((requeueErr) => {
        logWorkerError('send_requeue_after_error_failed', requeueErr, { sendId, accountId: send.accountId });
      });
      emit('send:status', { sendId, status: 'scheduled' });
    }
  }
}

// Worker in-process: a cada 10s pega os disparos vencidos. Processa em PARALELO
// por conta (cada conta dispara seu lote ao mesmo tempo que as outras), mas só um
// disparo por vez POR conta — respeita o pacing anti-banimento de cada número.
const processingAccounts = new Set();
let timer = null;

// Tempo máximo que um disparo espera a conta voltar a ter sessão viva antes de falhar de vez.
// Sem este teto ele ficaria preso para sempre se a conta nunca reconectar; com ele, um disparo
// que pegou uma janela curta de reconexão (ex.: logo após o Passenger reciclar o processo) espera
// a conta voltar e dispara de verdade, em vez de ser queimado na hora como "failed".
const MAX_ESPERA_CONTA_MS = 30 * 60000;

async function tick() {
  if (!isLeaderProcess()) return;
  const due = await scheduledSendsRepo.listDue().catch(() => []);
  for (const send of due) {
    if (processingAccounts.has(send.accountId)) continue;
    const pausaAte = await getAccountSendPause(send.accountId).catch(() => null);
    if (pausaAte) continue;
    // Guarda anti-falha-falsa: só processa se a conta estiver com a conexão ABERTA (não basta o
    // socket existir, ele pode estar em handshake). Sem conexão, NÃO queima o disparo, adia para um
    // tick futuro (quando a sessão reconectar). Se a conta não voltar dentro de MAX_ESPERA_CONTA_MS,
    // aí sim encerra como falha explícita para não ficar preso eternamente.
    if (!isConnected(send.accountId)) {
      const esperando = Date.now() - new Date(send.agendadoPara).getTime();
      if (esperando > MAX_ESPERA_CONTA_MS) {
        // Só grava o placeholder account_offline se NÃO houver parcial — assim uma retomada que já
        // enviou para vários grupos não perde o registro de quem recebeu.
        let temParcial = false;
        try {
          await scheduledSendsRepo.ensureTargets(send);
          const targets = await scheduledSendsRepo.listTargets(send.id);
          temParcial = targets.some((t) => t.status === 'sent' || t.status === 'failed' || t.status === 'skipped');
        } catch {
          temParcial = false;
        }
        await scheduledSendsRepo.failOpenTargets(send.id, 'account_offline').catch(() => {});
        const fim = await scheduledSendsRepo.finishIfTargetsComplete(send.id).catch(() => null);
        if (fim?.complete) emit('send:status', { sendId: send.id, status: fim.status });
        else if (!temParcial) emit('send:status', { sendId: send.id, status: 'failed' });
        // Disparo queimado porque a conta nunca voltou: o caso do incidente de 29/07/2026.
        await alertarDisparoFinalizado(send, {
          status: fim?.complete ? fim.status : 'failed',
          total: fim?.total || 0,
          ok: fim?.okCount || 0,
          erro: 'conta sem conexão por mais de 30min',
        });
      } else {
        await pauseAccountSending(
          send.accountId,
          SEND_PACKAGE.pausaCurtaContaMin,
          SEND_PACKAGE.pausaCurtaContaMax,
          'not_connected_before_send',
        );
      }
      continue;
    }
    processingAccounts.add(send.accountId);
    // Não aguarda: contas diferentes rodam concorrentemente.
    const generation = workerGeneration;
    processSend(send.id, generation)
      .catch((err) => {
        logWorkerError('send_process_promise_rejected', err, { sendId: send.id, accountId: send.accountId });
      })
      .finally(() => processingAccounts.delete(send.accountId));
  }
}

// ── Fila de remoção de participantes duplicados (M6.6) ──────────────────────────
// Mesmo pacing anti-banimento com ENVIO EM PACOTES do M6.3: uma remoção por conta de cada
// vez, intervalo aleatório entre remoções; a cada pacote de N remoções a conta faz uma pausa
// longa antes do próximo pacote. Contas diferentes em paralelo. Remover participante é ação
// sensível, então o intervalo entre remoções segue em 30–60s (já validado pelo dono) e os
// pacotes protegem os lotes grandes.
const REMOCAO_MIN_MS = 30000;
const REMOCAO_MAX_MS = 60000;
const REMOCAO_PACOTE_TAMANHO = 30; // remoções por pacote, por conta
const REMOCAO_PACOTE_PAUSA_MIN_MS = 30 * 60000; // pausa mín. entre pacotes (30 min)
const REMOCAO_PACOTE_PAUSA_MAX_MS = 45 * 60000; // pausa máx. entre pacotes (45 min)
const removingAccounts = new Set();
const removalNextAt = new Map(); // accountId -> timestamp a partir do qual pode remover de novo
const removalDoneCount = new Map(); // accountId -> nº de remoções no lote atual (p/ pacote)

async function processOneRemoval(accountId) {
  if (!isLeaderProcess()) return;
  const item = await removalsRepo.nextForAccount(accountId);
  if (!item) {
    removalDoneCount.delete(accountId); // fila da conta esvaziou: zera a contagem de pacote
    return;
  }
  let contaCaiu = false;
  try {
    // jid completo (PN ou LID); fallback p/ PN em registros antigos sem jid.
    const jid = item.jid || `${item.numero}@s.whatsapp.net`;
    await removeParticipant(item.accountId, item.waGroupId, jid);
    await removalsRepo.setStatus(item.id, 'done');
    // reflete no estado local de participantes (some da contagem de duplicados)
    await prisma.groupParticipant
      .deleteMany({ where: { groupId: item.groupId, numero: item.numero } })
      .catch(() => {});
  } catch (err) {
    await removalsRepo.setStatus(item.id, 'failed', { erro: (err.message || 'falhou').slice(0, 180) });
    if (err.code === 'not_connected') contaCaiu = true;
  }
  if (contaCaiu) {
    // CIRCUIT BREAKER: a conta caiu/foi deslogada no meio do lote. Não insistir — cancela o
    // restante das remoções dela e atualiza o progresso. O dono reavalia quando a conta voltar.
    await removalsRepo.cancelQueuedForAccount(accountId, 'conta desconectada durante o lote').catch(() => {});
    removalDoneCount.delete(accountId);
    removalNextAt.set(accountId, Date.now() + 60000);
    const progCaiu = await removalsRepo.progress(item.campaignId).catch(() => null);
    if (progCaiu) emit('removal:progress', { campaignId: item.campaignId, ...progCaiu });
    return;
  }

  const prog = await removalsRepo.progress(item.campaignId).catch(() => null);
  if (prog) emit('removal:progress', { campaignId: item.campaignId, ...prog });
  // remoção concluída: contabiliza no pacote da conta e agenda a próxima
  const feitas = (removalDoneCount.get(accountId) || 0) + 1;
  removalDoneCount.set(accountId, feitas);
  const resta = await removalsRepo.countQueuedForAccount(accountId).catch(() => 0);
  const fimDePacote = resta > 0 && feitas % REMOCAO_PACOTE_TAMANHO === 0;
  const espera = fimDePacote
    ? randomInterval(REMOCAO_PACOTE_PAUSA_MIN_MS, REMOCAO_PACOTE_PAUSA_MAX_MS)
    : randomInterval(REMOCAO_MIN_MS, REMOCAO_MAX_MS);
  removalNextAt.set(accountId, Date.now() + espera);
}

async function removalTick() {
  if (!isLeaderProcess()) return;
  const contas = await removalsRepo.accountsWithQueued().catch(() => []);
  const agora = Date.now();
  for (const accountId of contas) {
    if (removingAccounts.has(accountId)) continue;
    if (agora < (removalNextAt.get(accountId) || 0)) continue;
    removingAccounts.add(accountId);
    processOneRemoval(accountId)
      .catch(() => {})
      .finally(() => removingAccounts.delete(accountId));
  }
}

let removalTimer = null;

// ── Fila de alteração de grupos em lote (M6.3) ──────────────────────────────────
// Pacing anti-banimento com ENVIO EM PACOTES (espelha o SendFlow): cada conta processa UMA
// alteração por vez, com intervalo curto aleatório entre grupos; a cada PACOTE de N grupos a
// conta faz uma PAUSA longa (dezenas de minutos) antes do próximo pacote. Contas diferentes
// rodam em paralelo. Em lotes grandes (centenas de grupos) isso reduz muito o risco de
// banimento. Conservador de propósito (decisão do dono: seguir o SendFlow, até mais lento).
// Cada alteração pode aplicar vários comandos no mesmo grupo (nome, descrição, permissões,
// promover) — isso é o normal de configurar um grupo; o espaçamento grande é ENTRE grupos.
const EDIT_MIN_MS = 45000; // intervalo mín. entre grupos, dentro do pacote (45s)
const EDIT_MAX_MS = 90000; // intervalo máx. entre grupos (90s)
const EDIT_PACOTE_TAMANHO = 30; // grupos por pacote, por conta
const EDIT_PACOTE_PAUSA_MIN_MS = 30 * 60000; // pausa mín. entre pacotes (30 min)
const EDIT_PACOTE_PAUSA_MAX_MS = 45 * 60000; // pausa máx. entre pacotes (45 min)
const editingAccounts = new Set();
const editNextAt = new Map(); // accountId -> timestamp a partir do qual pode alterar de novo
const editDoneCount = new Map(); // accountId -> nº de alterações já feitas no lote atual (p/ pacote)

async function processOneGroupEdit(accountId) {
  if (!isLeaderProcess()) return;
  const item = await groupEditsRepo.nextForAccount(accountId);
  if (!item) {
    editDoneCount.delete(accountId); // fila da conta esvaziou: zera a contagem de pacote
    return;
  }
  let edits = {};
  try {
    edits = JSON.parse(item.edits || '{}');
  } catch {
    edits = {};
  }
  let contaCaiu = false;
  try {
    const r = await applyGroupEdits(item.accountId, item.waGroupId, edits);
    if (edits.nome !== undefined && r.aplicadas.includes('nome')) {
      await groupsRepo.setNome(item.groupId, edits.nome).catch(() => {});
    }
    if (r.aplicadas.length === 0 && r.falhas.length > 0) {
      // nada aplicado: registra como falha (ex.: conta não-admin, números fora do grupo)
      await groupEditsRepo.setStatus(item.id, 'failed', { erro: r.falhas.map((f) => f.campo).join(', ').slice(0, 180) });
    } else if (r.falhas.length > 0) {
      // aplicação parcial: marca concluída mas guarda quais campos falharam
      await groupEditsRepo.setStatus(item.id, 'done', { erro: `parcial: ${r.falhas.map((f) => f.campo).join(', ')}`.slice(0, 180) });
    } else {
      await groupEditsRepo.setStatus(item.id, 'done');
    }
  } catch (err) {
    await groupEditsRepo.setStatus(item.id, 'failed', { erro: (err.message || 'falhou').slice(0, 180) });
    if (err.code === 'not_connected') contaCaiu = true;
  }
  if (contaCaiu) {
    // CIRCUIT BREAKER: a conta caiu/foi deslogada no meio do lote. Não insistir (martelar uma
    // conta que o WhatsApp pode estar observando é arriscado) — cancela o restante do lote dela
    // e atualiza o progresso. O dono reavalia e reenvia quando a conta voltar.
    await groupEditsRepo.cancelQueuedForAccount(accountId, 'conta desconectada durante o lote').catch(() => {});
    editDoneCount.delete(accountId);
    editNextAt.set(accountId, Date.now() + 60000);
    const progCaiu = await groupEditsRepo.progress(item.campaignId).catch(() => null);
    if (progCaiu) emit('groupedit:progress', { campaignId: item.campaignId, ...progCaiu });
    return;
  }

  const prog = await groupEditsRepo.progress(item.campaignId).catch(() => null);
  if (prog) emit('groupedit:progress', { campaignId: item.campaignId, ...prog });
  // ação concluída: contabiliza no pacote da conta e agenda a próxima
  const feitas = (editDoneCount.get(accountId) || 0) + 1;
  editDoneCount.set(accountId, feitas);
  const resta = await groupEditsRepo.countQueuedForAccount(accountId).catch(() => 0);
  // fecha pacote a cada N alterações (e só pausa se ainda houver trabalho pela frente)
  const fimDePacote = resta > 0 && feitas % EDIT_PACOTE_TAMANHO === 0;
  const espera = fimDePacote
    ? randomInterval(EDIT_PACOTE_PAUSA_MIN_MS, EDIT_PACOTE_PAUSA_MAX_MS)
    : randomInterval(EDIT_MIN_MS, EDIT_MAX_MS);
  editNextAt.set(accountId, Date.now() + espera);
}

async function groupEditTick() {
  if (!isLeaderProcess()) return;
  const contas = await groupEditsRepo.accountsWithQueued().catch(() => []);
  const agora = Date.now();
  for (const accountId of contas) {
    if (editingAccounts.has(accountId)) continue;
    if (agora < (editNextAt.get(accountId) || 0)) continue;
    editingAccounts.add(accountId);
    processOneGroupEdit(accountId)
      .catch(() => {})
      .finally(() => editingAccounts.delete(accountId));
  }
}

let editTimer = null;

// ── Fila de moderação de solicitações de entrada (M9.1) ─────────────────────────
// Aprovar/recusar pedidos de entrada é MUTAÇÃO REAL — aprovar coloca +1 membro no grupo, o que
// em rajada é gatilho de banimento. Mesmo pacing com ENVIO EM PACOTES do M6.3: cada conta
// processa UMA solicitação por vez (45–90s entre cada); a cada pacote de N a conta faz uma pausa
// longa antes do próximo. Contas diferentes em paralelo. Recusar não adiciona ninguém, mas segue
// o mesmo ritmo por simplicidade e segurança (a fila mistura approve/reject por conta).
const ENTRY_MIN_MS = 45000; // intervalo mín. entre solicitações, dentro do pacote (45s)
const ENTRY_MAX_MS = 90000; // intervalo máx. entre solicitações (90s)
const ENTRY_PACOTE_TAMANHO = 30; // solicitações por pacote, por conta
const ENTRY_PACOTE_PAUSA_MIN_MS = 30 * 60000; // pausa mín. entre pacotes (30 min)
const ENTRY_PACOTE_PAUSA_MAX_MS = 45 * 60000; // pausa máx. entre pacotes (45 min)
const entryAccounts = new Set();
const entryNextAt = new Map(); // accountId -> timestamp a partir do qual pode moderar de novo
const entryDoneCount = new Map(); // accountId -> nº de moderações no lote atual (p/ pacote)

async function processOneEntryRequest(accountId) {
  if (!isLeaderProcess()) return;
  const item = await entryRequestsRepo.nextForAccount(accountId);
  if (!item) {
    entryDoneCount.delete(accountId); // fila da conta esvaziou: zera a contagem de pacote
    return;
  }
  const acao = item.acao === 'reject' ? 'reject' : 'approve';
  const jid = item.jid || `${item.numero}@s.whatsapp.net`;
  let contaCaiu = false;
  try {
    const res = await updateEntryRequests(item.accountId, item.waGroupId, [jid], acao);
    const status = String(res[0]?.status || '');
    if (status === '200' || status === '') {
      // '200' = ok; vazio = o WhatsApp não devolveu erro (a solicitação pode já ter saído da lista)
      await entryRequestsRepo.setStatus(item.id, acao === 'approve' ? 'approved' : 'rejected', { erro: null });
    } else {
      await entryRequestsRepo.setStatus(item.id, 'failed', { erro: `status_${status}`.slice(0, 180) });
    }
  } catch (err) {
    await entryRequestsRepo.setStatus(item.id, 'failed', { erro: (err.message || 'falhou').slice(0, 180) });
    if (err.code === 'not_connected') contaCaiu = true;
  }
  if (contaCaiu) {
    // CIRCUIT BREAKER: a conta caiu/foi deslogada no meio do lote. Devolve o restante dela para
    // `pending` (não insistir numa conta que o WhatsApp pode estar observando) e atualiza o progresso.
    await entryRequestsRepo.cancelQueuedForAccount(accountId).catch(() => {});
    entryDoneCount.delete(accountId);
    entryNextAt.set(accountId, Date.now() + 60000);
    const progCaiu = await entryRequestsRepo.progress(item.campaignId, item.loteId).catch(() => null);
    if (progCaiu) emit('entryreq:progress', { campaignId: item.campaignId, loteId: item.loteId, ...progCaiu });
    return;
  }

  const prog = await entryRequestsRepo.progress(item.campaignId, item.loteId).catch(() => null);
  if (prog) emit('entryreq:progress', { campaignId: item.campaignId, loteId: item.loteId, ...prog });
  // moderação concluída: contabiliza no pacote da conta e agenda a próxima
  const feitas = (entryDoneCount.get(accountId) || 0) + 1;
  entryDoneCount.set(accountId, feitas);
  const resta = await entryRequestsRepo.countQueuedForAccount(accountId).catch(() => 0);
  const fimDePacote = resta > 0 && feitas % ENTRY_PACOTE_TAMANHO === 0;
  const espera = fimDePacote
    ? randomInterval(ENTRY_PACOTE_PAUSA_MIN_MS, ENTRY_PACOTE_PAUSA_MAX_MS)
    : randomInterval(ENTRY_MIN_MS, ENTRY_MAX_MS);
  entryNextAt.set(accountId, Date.now() + espera);
}

async function entryRequestTick() {
  if (!isLeaderProcess()) return;
  const contas = await entryRequestsRepo.accountsWithQueued().catch(() => []);
  const agora = Date.now();
  for (const accountId of contas) {
    if (entryAccounts.has(accountId)) continue;
    if (agora < (entryNextAt.get(accountId) || 0)) continue;
    entryAccounts.add(accountId);
    processOneEntryRequest(accountId)
      .catch(() => {})
      .finally(() => entryAccounts.delete(accountId));
  }
}

let entryTimer = null;

// Fechamento automático da interação (Leva 2a): grupos criados pela plataforma nascem abertos
// (todos enviam) e fecham sozinhos após a janela configurada na campanha (só admin envia) —
// anti-banimento. Este tick fecha os que venceram. Volume baixíssimo (1x por grupo, ~24h após
// criar), então não precisa do pacing pesado; processa uns poucos por vez e pula contas offline.
let interacaoBusy = false;
async function interacaoTick() {
  if (!isLeaderProcess()) return;
  if (interacaoBusy) return;
  interacaoBusy = true;
  try {
    const vencidos = await groupsRepo.interacoesVencidas(20).catch(() => []);
    for (const g of vencidos) {
      if (!getSock(g.accountId)) continue; // conta offline: tenta no próximo tick
      try {
        await setSomenteAdminEnvia(g.accountId, g.waGroupId, true);
        await groupsRepo.marcarInteracaoFechada(g.id);
        emit('group:interaction-closed', { groupId: g.id, campaignId: g.campaignId });
      } catch {
        // falhou (ex.: conta não é admin) — tenta de novo no próximo tick
      }
    }
  } finally {
    interacaoBusy = false;
  }
}
let interacaoTimer = null;

// Recupera disparos órfãos: ficaram presos em `processing` porque o processo caiu/reiniciou no
// meio do envio (crash do Baileys antes das correções, ou reciclagem do processo pelo Passenger).
// Roda UMA vez no boot, antes de qualquer disparo novo começar — logo, todo `processing` encontrado
// aqui é de um processo anterior. Em vez de finalizar pela metade, RETOMA: volta para `scheduled`
// para o worker CONTINUAR só os grupos que faltam (processSend pula os já tentados). Assim o
// disparo chega a todos os grupos mesmo que o processo reinicie no meio. Reagenda para agora para
// reiniciar o teto de espera da conta (não falhar por engano num instante de conta oscilando).
// Continua sem reenviar a quem já recebeu.
export async function recoverStuckSends() {
  if (!isLeaderProcess()) return 0;
  const presos = await prisma.scheduledSend.findMany({ where: { status: 'processing' } }).catch(() => []);
  for (const s of presos) {
    await scheduledSendsRepo.ensureTargets(s).catch(() => {});
    await scheduledSendsRepo.resetProcessingTargets(s.id).catch(() => {});
    await scheduledSendsRepo.syncResultadoFromTargets(s.id).catch(() => {});
    await scheduledSendsRepo.setStatus(s.id, 'scheduled', {
      agendadoPara: new Date(),
      claimedByInstanceId: null,
      claimedByPid: null,
      claimedAt: null,
    }).catch(() => {});
    emit('send:status', { sendId: s.id, status: 'scheduled' });
  }
  return presos.length;
}

export function startWorker() {
  requireExternalIntegration();
  if (!isLeaderProcess()) return;
  workerGeneration += 1;
  if (!timer) timer = setInterval(() => tick(), 10000);
  if (!removalTimer) removalTimer = setInterval(() => removalTick(), 5000);
  if (!editTimer) editTimer = setInterval(() => groupEditTick(), 5000);
  if (!entryTimer) entryTimer = setInterval(() => entryRequestTick(), 5000);
  if (!interacaoTimer) interacaoTimer = setInterval(() => interacaoTick(), 60000);
}

export function stopWorker() {
  workerGeneration += 1;
  if (timer) clearInterval(timer);
  timer = null;
  if (removalTimer) clearInterval(removalTimer);
  removalTimer = null;
  if (editTimer) clearInterval(editTimer);
  editTimer = null;
  if (entryTimer) clearInterval(entryTimer);
  entryTimer = null;
  if (interacaoTimer) clearInterval(interacaoTimer);
  interacaoTimer = null;
}
