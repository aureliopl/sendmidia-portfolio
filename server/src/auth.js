import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import { allowedOrigin, createLoginLimiter, passwordMatches, passwordVersion, sessionIsValid, SESSION_SECONDS } from './security.js';

async function authPlugin(app) {
  const key = process.env.SESSION_SECRET;
  const password = process.env.APP_PASSWORD;
  if (!/^[a-f0-9]{64}$/i.test(key || '') || /^0+$/.test(key)) throw new Error('Defina SESSION_SECRET com 32 bytes aleatorios em hexadecimal.');
  if (!password || password.length < 12 || /troque|change.?me|example/i.test(password)) throw new Error('Defina APP_PASSWORD forte com pelo menos 12 caracteres.');
  await app.register(fastifyCookie);
  await app.register(fastifySecureSession, {
    key: Buffer.from(key, 'hex'), cookieName: 'sendmidia_session', expiry: SESSION_SECONDS,
    cookie: { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_SECONDS },
  });
  const allowLogin = createLoginLimiter();
  const publicPaths = new Set(['/api/health', '/api/auth/login', '/api/auth/me']);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.headers['x-requested-with'] !== 'Sendmidia'
        || (req.headers.origin && !allowedOrigin(req.headers.origin))) {
        return reply.code(403).send({ ok: false, error: 'invalid_origin' });
      }
    }
    if (!publicPaths.has(req.url.split('?')[0]) && !sessionIsValid(req.session)) {
      return reply.code(401).send({ ok: false, error: 'not_authenticated' });
    }
  });
  app.post('/api/auth/login', async (req, reply) => {
    if (!allowLogin(req.ip)) return reply.code(429).send({ ok: false, error: 'too_many_attempts' });
    if (!passwordMatches(req.body?.password)) return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
    req.session.set('authenticated', true);
    req.session.set('passwordVersion', passwordVersion());
    req.session.set('issuedAt', Date.now());
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => ({ ok: true, authenticated: sessionIsValid(req.session) }));
  app.post('/api/auth/logout', async (req) => { req.session.delete(); return { ok: true }; });
}
export default fp(authPlugin, { name: 'auth' });
