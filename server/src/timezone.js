const DEFAULT_TIME_ZONE = 'UTC';

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function clientTimeZone(req) {
  const header = req?.headers?.['x-browser-time-zone'];
  const timeZone = Array.isArray(header) ? header[0] : header;
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

function partsFor(date, timeZone, withHour = false) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withHour ? { hour: '2-digit', hourCycle: 'h23' } : {}),
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
  };
}

export function localDayKey(date, timeZone) {
  const p = partsFor(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localDayLabel(date, timeZone) {
  const p = partsFor(date, timeZone);
  return `${p.day}/${p.month}`;
}

export function localHourKey(date, timeZone) {
  const p = partsFor(date, timeZone, true);
  return `${p.year}-${p.month}-${p.day} ${p.hour}`;
}

export function localHourLabel(date, timeZone) {
  return `${partsFor(date, timeZone, true).hour}h`;
}

export function addPlainDays(dayKey, amount) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
