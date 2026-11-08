// POLÍTICA DE CONEXÃO das contas WhatsApp.
//
// Este módulo é deliberadamente PURO e SEM DEPENDÊNCIAS (nem Baileys, nem banco, nem rede): ele
// decide, e quem executa é o `manager.js`. O motivo é concreto: as duas falhas graves de
// 28 e 29/07/2026 foram erros de decisão que nenhum teste conseguia alcançar, porque a regra
// estava embutida no meio do handler de socket. Isolada aqui, cada regra é verificável.
//
// Os códigos são numéricos de propósito, espelhando `DisconnectReason` do Baileys, para que este
// arquivo não precise importar a biblioteca.

export const LOGGED_OUT = 401; // o aparelho desvinculou este dispositivo
export const CONNECTION_REPLACED = 440; // outra conexão assumiu esta sessão
export const BAD_SESSION = 500; // Baileys também usa isto para erro genérico de stream

// Códigos em que o WhatsApp está ATIVAMENTE recusando a conexão. Insistir rápido não reconecta e
// ainda prolonga a recusa: em 29/07/2026 foram medidas 17.296 recusas 405 em 12h porque a
// reconexão tentava a cada 2s.
export const CODIGOS_RECUSA = new Set([403, 405]);

// Duas escadas de espera, porque os motivos são de naturezas opostas.
export const BACKOFF_TRANSIENTE_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
export const BACKOFF_RECUSA_MS = [60000, 180000, 300000, 600000, 900000, 1800000];

// Teto de tentativas de QR para uma conta que NUNCA foi pareada. Não afeta conta pareada.
export const MAX_TENTATIVAS_QR = 10;

// Quanto esperar antes da tentativa `tentativa` (base 0), dado o motivo da queda.
export function esperaReconexao(tentativa, statusCode) {
  const escada = CODIGOS_RECUSA.has(statusCode) ? BACKOFF_RECUSA_MS : BACKOFF_TRANSIENTE_MS;
  const base = escada[Math.min(Math.max(tentativa, 0), escada.length - 1)];
  // Jitter de ±25% para não sincronizar as reconexões de várias contas no mesmo instante.
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(1000, Math.round(base + jitter));
}

// O que fazer quando a conexão de uma conta cai.
// `paired` vem do DISCO (existe `creds.json`), nunca de flag interna do Baileys: `creds.registered`
// é `false` até em conta pareada e funcionando, o que invalidou a correção de 29/07/2026.
export function decidirAposQueda({ paired, statusCode, tentativasQr = 0 }) {
  // Único caso que apaga credenciais: declaração inequívoca do WhatsApp de que fomos desvinculados.
  if (statusCode === LOGGED_OUT) return { acao: 'apagar_sessao' };
  // Não brigar por uma sessão que outra conexão assumiu; o watchdog retoma depois do resfriamento.
  if (statusCode === CONNECTION_REPLACED) return { acao: 'soltar_posse' };
  if (!paired) {
    if (tentativasQr + 1 > MAX_TENTATIVAS_QR) return { acao: 'parar_pareamento' };
    return { acao: 'renovar_qr' };
  }
  // Conta pareada SEMPRE reconecta, qualquer que seja o motivo (inclusive badSession/500, que não
  // pode apagar a sessão: o Baileys usa esse código também para erro genérico de stream).
  return { acao: 'reconectar' };
}
