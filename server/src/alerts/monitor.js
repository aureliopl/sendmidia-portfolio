// MONITOR DE ALERTAS. Junta as três peças: recebe eventos do sistema, aplica as regras puras de
// `rules.js` e despacha pelos canais de `channels.js`.
//
// Aqui mora todo o estado com tempo: a janela de agrupamento (para uma tempestade virar UMA
// mensagem), o cooldown por assunto e o teto por hora. Nada disso está nas regras justamente para
// que as regras possam ser testadas sem relógio.

import { accountsRepo } from '../repositories/index.js';
import { instanceId, isProd } from '../runtime.js';
import { algumCanalConfigurado, despachar } from './channels.js';
import {
  CRITICO,
  CODIGOS_RECUSA,
  JANELA_AGRUPAMENTO_MS,
  COOLDOWN_MS,
  TETO_MENSAGENS_HORA,
  classificarEventoConexao,
  classificarDisparo,
  consolidarLote,
  dentroDoTeto,
  formatarMensagem,
  podeEnviar,
} from './rules.js';

let logger = null;
let ligado = true;
let avisouFaltaDeCanal = false;

// Um alerta crítico agrupa só os irmãos imediatos (as outras contas caindo no mesmo segundo) e sai.
const ESPERA_CRITICO_MS = 3000;

// Alertas aguardando a janela fechar. Chave -> alerta (com `ocorrencias` acumuladas).
const pendentes = new Map();
let janelaTimer = null;
// Instante em que a janela aberta vai fechar; permite antecipá-la quando chega algo mais urgente.
let janelaFechaEm = 0;

// Chave -> epoch ms do último envio, para o cooldown.
const ultimoEnvioPorChave = new Map();
// Ocorrências que o cooldown segurou; viram contador na próxima mensagem.
let suprimidosDesdeUltimoEnvio = 0;
// Timestamps das mensagens enviadas, para o teto por hora (janela móvel).
const enviosRecentes = [];
// accountId -> recusas consecutivas do WhatsApp desde a última conexão bem-sucedida.
const recusasSeguidas = new Map();

export function attachMonitorLogger(appLogger) {
  logger = appLogger;
}

// O monitor só age no processo líder: com dois processos, o dono receberia tudo em duplicidade.
export function setMonitorEnabled(valor) {
  ligado = Boolean(valor);
  if (!ligado) limparJanela();
}

function log(nivel, dados, msg) {
  if (!logger) return;
  (logger[nivel] || logger.info).call(logger, { event: 'alerta_monitor', instanceId, ...dados }, msg);
}

function limparJanela() {
  if (janelaTimer) clearTimeout(janelaTimer);
  janelaTimer = null;
  janelaFechaEm = 0;
  pendentes.clear();
}

// Ponto de entrada dos eventos de conexão. É chamado de dentro do `logConnection` do manager, ou
// seja, TODO evento de conexão passa por aqui sem que ninguém precise lembrar de instrumentar.
export function observarConexao(accountId, stage, extra = {}) {
  if (!ligado) return;

  // Conectou: zera o contador de recusas desta conta.
  if (stage === 'open') {
    recusasSeguidas.delete(accountId);
    return;
  }

  let recusas = recusasSeguidas.get(accountId) || 0;
  if (stage === 'reconnect_scheduled' && CODIGOS_RECUSA.has(extra.statusCode)) {
    recusas += 1;
    recusasSeguidas.set(accountId, recusas);
  }

  const alerta = classificarEventoConexao({ ...extra, stage, accountId, recusasSeguidas: recusas });
  if (alerta) enfileirar(alerta);
}

// Disparo agendado que terminou mal (falha total ou entrega parcial).
export function observarDisparo(dados) {
  if (!ligado) return;
  const alerta = classificarDisparo(dados);
  if (alerta) enfileirar(alerta);
}

function enfileirar(alerta) {
  const agora = Date.now();
  const jaNaFila = pendentes.get(alerta.chave);
  if (jaNaFila) {
    jaNaFila.ocorrencias = (jaNaFila.ocorrencias || 1) + 1;
    return;
  }

  // Cooldown: assunto repetido não vira mensagem nova, só engorda o contador que será mostrado
  // no próximo envio. Assim uma conta oscilando a noite toda não gera 200 mensagens, mas também
  // não desaparece do relatório.
  if (!podeEnviar({ severidade: alerta.severidade, ultimoEnvio: ultimoEnvioPorChave.get(alerta.chave) || 0, agora, cooldownMs: COOLDOWN_MS })) {
    suprimidosDesdeUltimoEnvio += 1;
    return;
  }

  pendentes.set(alerta.chave, { ...alerta, ocorrencias: 1 });

  // Crítico não espera a janela inteira: sai em 3s (tempo só de agrupar os irmãos que costumam
  // chegar juntos, como as 6 contas caindo no mesmo segundo).
  const espera = alerta.severidade === CRITICO ? ESPERA_CRITICO_MS : JANELA_AGRUPAMENTO_MS;
  const alvo = agora + espera;
  // Se já existe uma janela aberta e este alerta precisa sair ANTES dela, a janela é antecipada.
  // Sem isto, um crítico que chega logo depois de um aviso ficaria preso esperando os 60s do aviso
  // — exatamente o tipo de atraso que este projeto existe para eliminar.
  if (janelaTimer && alvo >= janelaFechaEm) return;
  if (janelaTimer) clearTimeout(janelaTimer);
  janelaFechaEm = alvo;
  janelaTimer = setTimeout(() => {
    janelaTimer = null;
    janelaFechaEm = 0;
    fecharJanela().catch((err) => log('error', { erro: String(err?.message || err) }, 'Falha ao fechar janela de alertas'));
  }, espera);
  janelaTimer.unref?.();
}

async function contextoDasContas() {
  const contas = await accountsRepo.list().catch(() => []);
  const nomes = {};
  let pareadas = 0;
  let conectadas = 0;
  for (const c of contas) {
    nomes[c.id] = c.nome || c.telefone || `conta ${c.id}`;
    // "Pareada" = tem sessão salva; é o universo que deveria estar no ar.
    if (c.sessionPath || c.status !== 'no_session') pareadas += 1;
    if (c.status === 'connected') conectadas += 1;
  }
  return { nomes, contasPareadas: pareadas, contasConectadas: conectadas };
}

async function fecharJanela() {
  const alertas = [...pendentes.values()];
  pendentes.clear();
  if (!alertas.length) return;

  const ctx = await contextoDasContas();
  const repetidos = alertas.reduce((acc, a) => acc + Math.max(0, (a.ocorrencias || 1) - 1), 0);
  const resumo = consolidarLote(alertas, {
    ...ctx,
    suprimidos: suprimidosDesdeUltimoEnvio + repetidos,
  });
  if (!resumo) return;

  const agora = Date.now();
  podarEnvios(agora);
  if (!dentroDoTeto({ severidade: resumo.severidade, enviosNaUltimaHora: enviosRecentes.length, teto: TETO_MENSAGENS_HORA })) {
    suprimidosDesdeUltimoEnvio += alertas.length;
    log('warn', { teto: TETO_MENSAGENS_HORA, suprimidos: suprimidosDesdeUltimoEnvio }, 'Teto de alertas por hora atingido; avisos agrupados para a próxima janela');
    return;
  }

  const texto = formatarMensagem(resumo, { ambiente: isProd ? 'produção' : 'desenvolvimento' });

  if (!algumCanalConfigurado()) {
    if (!avisouFaltaDeCanal) {
      avisouFaltaDeCanal = true;
      log('warn', {}, 'Alertas sem canal configurado (defina ALERT_TELEGRAM_BOT_TOKEN/ALERT_TELEGRAM_CHAT_ID)');
    }
    log('warn', { titulo: resumo.titulo, texto }, 'Alerta não enviado (sem canal configurado)');
    return;
  }

  const { entregue } = await despachar({ severidade: resumo.severidade, titulo: resumo.titulo, texto });
  if (entregue) {
    enviosRecentes.push(agora);
    suprimidosDesdeUltimoEnvio = 0;
    for (const a of alertas) ultimoEnvioPorChave.set(a.chave, agora);
  }
}

function podarEnvios(agora) {
  const limite = agora - 3600000;
  while (enviosRecentes.length && enviosRecentes[0] < limite) enviosRecentes.shift();
}

// Mensagem de verificação, para confirmar de ponta a ponta que os canais entregam.
export async function enviarAlertaDeTeste(origem = 'manual') {
  const ctx = await contextoDasContas();
  const texto = formatarMensagem(
    {
      severidade: CRITICO,
      titulo: 'teste de alerta',
      linhas: [
        '- Esta é uma mensagem de verificação disparada de propósito.',
        `- Origem: ${origem}.`,
      ],
      rodape: [`Contas conectadas agora: ${ctx.contasConectadas}/${ctx.contasPareadas}.`],
    },
    { ambiente: isProd ? 'produção' : 'desenvolvimento' },
  );
  return despachar({ severidade: CRITICO, titulo: 'teste de alerta', texto });
}

// Injeta um evento de conexão como se viesse do manager. Serve para verificar a cadeia inteira
// (regras + agrupamento + canais) sem precisar derrubar uma conta de verdade.
export function simularEventoConexao(accountId, stage, extra = {}) {
  observarConexao(accountId, stage, extra);
}

export function estadoDoMonitor() {
  return {
    ligado,
    canaisConfigurados: algumCanalConfigurado(),
    pendentes: pendentes.size,
    enviosNaUltimaHora: enviosRecentes.length,
    suprimidos: suprimidosDesdeUltimoEnvio,
  };
}
