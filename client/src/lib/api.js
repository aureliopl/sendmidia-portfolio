import { browserTimeZone } from './datetime';

// Wrapper de fetch para a API. Só declara JSON quando há corpo: um POST/DELETE sem
// corpo com Content-Type application/json faz o Fastify devolver 400
// (FST_ERR_CTP_EMPTY_JSON_BODY).
export async function api(url, options = {}) {
  const headers = {
    'X-Browser-Time-Zone': browserTimeZone(),
    'X-Browser-Time-Zone-Offset': String(new Date().getTimezoneOffset()),
    ...options.headers,
  };
  if (options.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}
