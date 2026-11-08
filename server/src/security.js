import { createHash, timingSafeEqual } from 'node:crypto';

export const AUTHENTICATED_ROOM = 'authenticated';
export const SESSION_SECONDS = 3600;
export function passwordVersion() {
  return createHash('sha256').update(process.env.APP_PASSWORD || '').digest('hex');
}
export function passwordMatches(candidate) {
  if (typeof candidate !== 'string') return false;
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(candidate), hash(process.env.APP_PASSWORD || ''));
}
export function allowedOrigin(origin) {
  try { return new URL(origin).origin === new URL(process.env.APP_ORIGIN || 'http://localhost:5173').origin; }
  catch { return false; }
}
export function sessionIsValid(session, now = Date.now()) {
  const issued = session?.get('issuedAt');
  return session?.get('authenticated') === true && session.get('passwordVersion') === passwordVersion()
    && Number.isFinite(issued) && issued <= now && now - issued < SESSION_SECONDS * 1000;
}
export function socketAuthentication(app) {
  return (socket, next) => {
    try {
      if (!allowedOrigin(socket.handshake.headers.origin)) throw new Error('invalid_origin');
      const cookies = app.parseCookie(socket.handshake.headers.cookie || '');
      const session = cookies.sendmidia_session ? app.decodeSecureSession(cookies.sendmidia_session) : null;
      if (!sessionIsValid(session)) throw new Error('not_authenticated');
      socket.data.expiresAt = session.get('issuedAt') + SESSION_SECONDS * 1000;
      next();
    } catch { next(new Error('not_authenticated')); }
  };
}
export function createLoginLimiter() {
  const clients = new Map();
  return (client, now = Date.now()) => {
    for (const [key, value] of clients) if (value.until <= now) clients.delete(key);
    if (!clients.has(client) && clients.size >= 5000) return false;
    const value = clients.get(client) || { attempts: 0, until: now + 900000 };
    clients.set(client, value);
    return ++value.attempts <= 10;
  };
}
