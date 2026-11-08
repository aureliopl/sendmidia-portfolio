export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatLocalDateTime(value, { seconds = false } = {}) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: seconds ? 'medium' : 'short',
    });
  } catch {
    return '—';
  }
}

export function formatLocalDate(value, options = {}) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('pt-BR', options);
  } catch {
    return '—';
  }
}

export function startOfLocalDay(value = new Date()) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfLocalDay(value = new Date()) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function localRangeForLastDays(days) {
  const total = Math.max(1, Number(days) || 1);
  const de = startOfLocalDay();
  de.setDate(de.getDate() - (total - 1));
  return {
    de: de.toISOString(),
    ate: new Date().toISOString(),
  };
}

export function localRangeForLastHours(hours) {
  const total = Math.max(1, Number(hours) || 1);
  const ate = new Date();
  const de = new Date(ate);
  de.setMinutes(0, 0, 0);
  de.setHours(de.getHours() - (total - 1));
  return {
    de: de.toISOString(),
    ate: ate.toISOString(),
  };
}

export function appendLocalRange(params, days) {
  const { de, ate } = localRangeForLastDays(days);
  params.set('de', de);
  params.set('ate', ate);
  return params;
}
