// Perfis de velocidade de disparo (intervalo aleatório entre grupos). Devem bater
// com SPEED_PROFILES do servidor (server/src/whatsapp/worker.js).
export const VELOCIDADES = [
  { value: 'rapida', label: 'Rápida (90–180s)' },
  { value: 'normal', label: 'Normal (140–460s)' },
  { value: 'lenta', label: 'Lenta (300–720s)' },
  { value: 'ultralenta', label: 'Ultra lenta (600–1200s)' },
  { value: 'custom', label: 'Custom' },
];

export const SPEED_PROFILES = {
  rapida: { min: 90, max: 180 },
  normal: { min: 140, max: 460 },
  lenta: { min: 300, max: 720 },
  ultralenta: { min: 600, max: 1200 },
};

export const SEND_PACKAGE = {
  tamanho: 15,
  pausaMin: 30 * 60,
  pausaMax: 45 * 60,
};

export function resolveSpeedProfile(perfil, customMin, customMax) {
  if (perfil === 'custom') {
    const min = Math.max(60, Number(customMin) || SPEED_PROFILES.normal.min);
    const max = Math.max(min, Number(customMax) || SPEED_PROFILES.normal.max);
    return { min, max };
  }
  return SPEED_PROFILES[perfil] || SPEED_PROFILES.normal;
}

export function estimateSendDuration({ totalGrupos, contas, perfilVelocidade, intervaloMin, intervaloMax }) {
  const total = Math.max(0, Number(totalGrupos) || 0);
  const nContas = Math.max(1, Number(contas) || 1);
  const { min, max } = resolveSpeedProfile(perfilVelocidade, intervaloMin, intervaloMax);
  const base = Math.floor(total / nContas);
  const extra = total % nContas;
  const porConta = Array.from({ length: nContas }, (_, i) => base + (i < extra ? 1 : 0));
  const estimarConta = (qtd, intervalo) => {
    if (qtd <= 1) return 0;
    const intervalos = qtd - 1;
    const pausas = Math.floor((qtd - 1) / SEND_PACKAGE.tamanho);
    const pausa = intervalo === min ? SEND_PACKAGE.pausaMin : SEND_PACKAGE.pausaMax;
    return intervalos * intervalo + pausas * pausa;
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
