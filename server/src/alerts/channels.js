import { EXTERNAL_INTEGRATIONS_ENABLED } from '../portfolio.js';
// CANAIS DE ALERTA. Transporte apenas: recebe texto pronto e entrega.
//
// Regra de ouro deste arquivo: o alerta precisa funcionar QUANDO O SISTEMA ESTÁ QUEBRADO. Por isso
// nada aqui depende do WhatsApp (que é justamente o que cai), do banco, ou de qualquer estado
// interno do app. São duas saídas independentes:
//   - Telegram: canal principal, recebe tudo. Um POST HTTPS, sem dependência nova.
//   - E-mail (SMTP): só os alertas CRÍTICOS, como segunda via caso o Telegram esteja indisponível.
//
// Falha de envio nunca derruba nada: cada canal é best-effort e reporta o resultado.

import { CRITICO } from './rules.js';

const TIMEOUT_MS = 10000;
const TENTATIVAS = 3;

let logger = null;
export function attachAlertLogger(appLogger) {
  logger = appLogger;
}

function log(nivel, dados, msg) {
  if (!logger) return;
  (logger[nivel] || logger.info).call(logger, { event: 'alerta_canal', ...dados }, msg);
}

export function telegramConfig() {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID || '';
  // Base sobrescrevível só para poder testar a cadeia inteira contra um servidor local, sem
  // credenciais reais e sem mandar mensagem de teste para o celular do dono.
  const apiBase = process.env.ALERT_TELEGRAM_API_BASE || 'https://api.telegram.org';
  return token && chatId ? { token, chatId, apiBase } : null;
}

export function emailConfig() {
  const host = process.env.ALERT_SMTP_HOST || '';
  const to = process.env.ALERT_EMAIL_TO || '';
  if (!host || !to) return null;
  return {
    host,
    port: Number(process.env.ALERT_SMTP_PORT) || 587,
    user: process.env.ALERT_SMTP_USER || '',
    pass: process.env.ALERT_SMTP_PASS || '',
    from: process.env.ALERT_SMTP_FROM || process.env.ALERT_SMTP_USER || to,
    to,
  };
}

// Um alerta configurado em pelo menos um canal já cumpre o objetivo; sem nenhum, o monitor
// só registra no log (e avisa uma vez, para a falta de configuração não passar despercebida).
export function algumCanalConfigurado() {
  return Boolean(telegramConfig() || emailConfig());
}

async function comTimeout(promessa, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  t.unref?.();
  try {
    return await promessa(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

export async function enviarTelegram(texto) {
  if (!EXTERNAL_INTEGRATIONS_ENABLED) return false;
  const cfg = telegramConfig();
  if (!cfg) return { ok: false, motivo: 'nao_configurado' };

  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    try {
      const res = await comTimeout(
        (signal) =>
          fetch(`${cfg.apiBase}/bot${cfg.token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.chatId,
              text: texto,
              disable_web_page_preview: true,
            }),
            signal,
          }),
        TIMEOUT_MS,
      );
      if (res.ok) return { ok: true };
      ultimoErro = `http_${res.status}`;
      // 4xx é erro de configuração (token/chat errados): repetir não resolve.
      if (res.status >= 400 && res.status < 500) break;
    } catch (err) {
      ultimoErro = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    }
    if (tentativa < TENTATIVAS) await new Promise((r) => setTimeout(r, 1000 * tentativa));
  }
  log('error', { canal: 'telegram', erro: ultimoErro }, 'Falha ao enviar alerta pelo Telegram');
  return { ok: false, motivo: ultimoErro };
}

// nodemailer é carregado sob demanda: quem não usa e-mail não paga o import.
let transporterPromise = null;
async function getTransporter(cfg) {
  if (!transporterPromise) {
    transporterPromise = import('nodemailer')
      .then(({ default: nodemailer }) =>
        nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.port === 465,
          auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
          connectionTimeout: TIMEOUT_MS,
          greetingTimeout: TIMEOUT_MS,
          socketTimeout: TIMEOUT_MS,
        }),
      )
      .catch((err) => {
        transporterPromise = null;
        throw err;
      });
  }
  return transporterPromise;
}

export async function enviarEmail(assunto, texto) {
  if (!EXTERNAL_INTEGRATIONS_ENABLED) return false;
  const cfg = emailConfig();
  if (!cfg) return { ok: false, motivo: 'nao_configurado' };
  try {
    const transporter = await getTransporter(cfg);
    await transporter.sendMail({ from: cfg.from, to: cfg.to, subject: assunto, text: texto });
    return { ok: true };
  } catch (err) {
    log('error', { canal: 'email', erro: String(err?.message || err) }, 'Falha ao enviar alerta por e-mail');
    return { ok: false, motivo: String(err?.message || err) };
  }
}

// Despacha por severidade: tudo vai para o Telegram; o e-mail duplica só os críticos.
export async function despachar({ severidade, titulo, texto }) {
  if (!EXTERNAL_INTEGRATIONS_ENABLED) return false;
  const resultados = { telegram: null, email: null };
  resultados.telegram = await enviarTelegram(texto);
  if (severidade === CRITICO && emailConfig()) {
    resultados.email = await enviarEmail(`[CRÍTICO] SendMídia: ${titulo}`, texto);
  }
  const entregue = Boolean(resultados.telegram?.ok || resultados.email?.ok);
  log(entregue ? 'info' : 'error', { severidade, titulo, resultados }, entregue ? 'Alerta enviado' : 'Alerta NÃO entregue');
  return { entregue, resultados };
}
