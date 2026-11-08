// REGRAS DE ALERTA do dono (monitoramento interno).
//
// Módulo deliberadamente PURO e SEM DEPENDÊNCIAS (nem rede, nem banco, nem timers), pelo mesmo
// motivo de `connectionPolicy.js`: em 29/07/2026 todas as contas caíram e o problema só foi
// descoberto horas depois, por acaso. Um alerta que não dispara é tão ruim quanto não ter alerta,
// e um alerta que dispara 50 vezes numa tempestade é ignorado no dia seguinte. As duas coisas se
// decidem aqui, onde dá para testar cada regra (`npm run test:alerts`).
//
// Quem envia é `channels.js`; quem controla o tempo e o estado é `monitor.js`.

export const CRITICO = 'critico';
export const AVISO = 'aviso';

// Códigos em que o WhatsApp está ATIVAMENTE recusando a conexão (espelham CODIGOS_RECUSA da
// política de conexão). Uma recusa isolada é ruído; recusa repetida é o sinal precoce do incidente.
export const CODIGOS_RECUSA = new Set([403, 405]);

// A partir desta espera o backoff já está nos patamares altos: a conta vai passar dezenas de
// minutos fora do ar. É o momento de avisar, não depois.
export const BACKOFF_ALTO_MS = 600000; // 10min

// Quantas recusas seguidas da mesma conta antes de avisar.
export const RECUSAS_PARA_ALERTAR = 3;

// Eventos que chegam dentro desta janela viram UMA mensagem. É o anti-flood principal: numa
// tempestade, as 6 contas caindo geram um resumo, não 6 mensagens.
export const JANELA_AGRUPAMENTO_MS = 60000;

// Uma mesma chave (ex.: "queda:conta-3") não gera nova mensagem antes disso. As ocorrências
// suprimidas viram contador na próxima mensagem que sair, então nada some silenciosamente.
export const COOLDOWN_MS = 30 * 60000;

// Teto duro de mensagens por hora. Estourou, o monitor silencia e manda um único aviso de silêncio.
export const TETO_MENSAGENS_HORA = 8;

// Alertas críticos furam o cooldown e o teto: "todas as contas caíram" precisa chegar sempre.
export const SEVERIDADES = [AVISO, CRITICO];

function alerta(tipo, severidade, chave, resumo, extra = {}) {
  return { tipo, severidade, chave, resumo, ...extra };
}

// Traduz um evento `whatsapp_connection` do manager em alerta, ou `null` se o evento é rotina.
// `recusasSeguidas` é o contador mantido pelo monitor (quantas recusas consecutivas esta conta
// acumulou desde a última conexão bem-sucedida).
export function classificarEventoConexao(ev = {}) {
  const { stage, accountId, statusCode = null, nextDelayMs = 0, motivo = null, recusasSeguidas = 0 } = ev;

  switch (stage) {
    // 401: o aparelho desvinculou este dispositivo. Só volta com QR novo, presencial.
    case 'logged_out':
      return alerta('sem_sessao', CRITICO, `sem_sessao:${accountId}`, 'foi desvinculada no aparelho e precisa de um QR novo', {
        accountId,
        statusCode,
      });

    // Pareamento abandonado: ninguém escaneou o QR dentro do teto de tentativas.
    case 'pairing_stopped':
      return alerta('sem_sessao', CRITICO, `sem_sessao:${accountId}`, 'parou de gerar QR sem ninguém escanear', {
        accountId,
        statusCode,
      });

    case 'close': {
      // Parada deliberada (o dono clicou "Desconectar", ou o processo está sendo encerrado num
      // deploy) não é incidente. Sem esta linha, todo deploy geraria alerta e o canal viraria ruído.
      if (ev.deliberado) return null;
      // Queda de conta. Sozinha é um aviso; o monitor decide na consolidação se o conjunto delas
      // configura o caso crítico de "todas caíram".
      return alerta('queda', AVISO, `queda:${accountId}`, descreverQueda(statusCode, motivo), {
        accountId,
        statusCode,
      });
    }

    case 'reconnect_scheduled': {
      // Sinal precoce nº 1: o WhatsApp está recusando de forma repetida.
      if (CODIGOS_RECUSA.has(statusCode) && recusasSeguidas >= RECUSAS_PARA_ALERTAR) {
        return alerta(
          'recusa_repetida',
          AVISO,
          `recusa:${accountId}`,
          `recusada ${recusasSeguidas}x seguidas pelo WhatsApp (${statusCode})`,
          { accountId, statusCode, nextDelayMs },
        );
      }
      // Sinal precoce nº 2: a espera chegou aos patamares altos, ou seja, a conta vai ficar fora
      // do ar por bastante tempo mesmo que nada mais dê errado.
      if (nextDelayMs >= BACKOFF_ALTO_MS) {
        return alerta(
          'backoff_alto',
          AVISO,
          `backoff:${accountId}`,
          `só tenta reconectar daqui a ${Math.round(nextDelayMs / 60000)}min (motivo: ${motivo || statusCode || 'desconhecido'})`,
          { accountId, statusCode, nextDelayMs },
        );
      }
      return null;
    }

    default:
      return null;
  }
}

function descreverQueda(statusCode, motivo) {
  if (CODIGOS_RECUSA.has(statusCode)) return `caiu com recusa do WhatsApp (${statusCode})`;
  if (statusCode === 440) return 'caiu porque outra conexão assumiu a sessão (440)';
  if (statusCode) return `caiu (${statusCode}${motivo ? ` ${motivo}` : ''})`;
  return `caiu${motivo ? ` (${motivo})` : ''}`;
}

// Alerta de disparo agendado que terminou mal.
export function classificarDisparo({ sendId, campanha, accountId, status, total = 0, ok = 0, erro = null }) {
  if (status !== 'failed' && !(status === 'sent' && ok < total)) return null;
  const parcial = status === 'sent';
  const alvo = campanha ? `disparo da campanha ${campanha}` : 'disparo agendado';
  const resumo = parcial
    ? `${alvo} entregou em ${ok} de ${total} grupos`
    : `${alvo} falhou${total ? ` nos ${total} grupos` : ''}${erro ? ` (${erro})` : ''}`;
  return alerta(
    parcial ? 'disparo_parcial' : 'disparo_falhou',
    parcial ? AVISO : CRITICO,
    `disparo:${sendId}`,
    resumo,
    { sendId, campanha, accountId, total, ok },
  );
}

// Consolida um lote de alertas numa única mensagem.
// `contasPareadas`/`contasConectadas` são medidos no instante do envio e permitem detectar o caso
// que motivou tudo isto: TODAS as contas fora do ar ao mesmo tempo.
export function consolidarLote(alertas, contexto = {}) {
  const { contasPareadas = 0, contasConectadas = 0, nomes = {}, suprimidos = 0 } = contexto;
  if (!alertas.length) return null;

  const quedas = alertas.filter((a) => a.tipo === 'queda');
  const apagaoGeral = contasPareadas >= 2 && contasConectadas === 0 && quedas.length > 0;

  const severidade = apagaoGeral || alertas.some((a) => a.severidade === CRITICO) ? CRITICO : AVISO;

  const titulo = apagaoGeral
    ? `TODAS as ${contasPareadas} contas estão fora do ar`
    : tituloDoLote(alertas);

  const linhas = [];
  for (const a of alertas) {
    const quem = a.accountId ? nomes[a.accountId] || `conta ${a.accountId}` : a.campanha || null;
    linhas.push(quem ? `- ${quem}: ${a.resumo}` : `- ${a.resumo}`);
  }

  const rodape = [];
  if (contasPareadas > 0) rodape.push(`Contas conectadas agora: ${contasConectadas}/${contasPareadas}.`);
  if (suprimidos > 0) rodape.push(`Outras ${suprimidos} ocorrências repetidas foram agrupadas nesta mensagem.`);

  return { severidade, titulo, linhas, rodape, apagaoGeral };
}

function tituloDoLote(alertas) {
  const criticos = alertas.filter((a) => a.severidade === CRITICO);
  const base = criticos.length ? criticos : alertas;
  if (base.length === 1) {
    const a = base[0];
    if (a.tipo === 'sem_sessao') return 'Conta precisa de QR novo';
    if (a.tipo === 'disparo_falhou') return 'Disparo agendado falhou';
    if (a.tipo === 'disparo_parcial') return 'Disparo agendado entregou parcialmente';
    if (a.tipo === 'queda') return 'Conta caiu';
    if (a.tipo === 'recusa_repetida') return 'WhatsApp recusando conexão';
    if (a.tipo === 'backoff_alto') return 'Conta com espera longa para reconectar';
    return 'Alerta do SendMídia';
  }
  const contas = new Set(base.map((a) => a.accountId).filter(Boolean));
  if (contas.size > 1) return `${contas.size} contas com problema`;
  return `${base.length} alertas`;
}

// Decide se uma chave pode gerar mensagem agora. `ultimoEnvio` é o epoch ms do último envio dessa
// mesma chave (0 se nunca). Crítico ignora cooldown: o dono precisa saber toda vez.
export function podeEnviar({ severidade, ultimoEnvio = 0, agora = Date.now(), cooldownMs = COOLDOWN_MS }) {
  if (severidade === CRITICO) return true;
  return agora - ultimoEnvio >= cooldownMs;
}

// Teto por hora. `enviosNaUltimaHora` é a contagem de mensagens já enviadas na janela móvel.
// Crítico também fura o teto — um apagão geral não pode ser silenciado por excesso de avisos.
export function dentroDoTeto({ severidade, enviosNaUltimaHora = 0, teto = TETO_MENSAGENS_HORA }) {
  if (severidade === CRITICO) return true;
  return enviosNaUltimaHora < teto;
}

// Texto final da mensagem. Texto puro, legível tanto no Telegram quanto no corpo de um e-mail.
export function formatarMensagem(resumo, { ambiente = 'production', quando = new Date() } = {}) {
  const marca = resumo.severidade === CRITICO ? '[CRÍTICO]' : '[AVISO]';
  const carimbo = quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const partes = [`${marca} SendMídia: ${resumo.titulo}`, '', ...resumo.linhas];
  if (resumo.rodape.length) partes.push('', ...resumo.rodape);
  partes.push('', `${carimbo} (${ambiente})`, 'https://example.com');
  return partes.join('\n');
}
