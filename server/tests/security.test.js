import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import auth from '../src/auth.js';
import { socketAuthentication, createLoginLimiter, sessionIsValid } from '../src/security.js';
import { EXTERNAL_INTEGRATIONS_ENABLED, requireExternalIntegration } from '../src/portfolio.js';

process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.APP_PASSWORD = randomBytes(24).toString('hex');
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
const headers = { 'x-requested-with': 'Sendmidia', origin: process.env.APP_ORIGIN };

test('login, CSRF, sessão e handshake com cookie real', async () => {
  const app = Fastify();
  app.register(auth);
  app.get('/api/private', async () => ({ ok: true }));
  await app.ready();
  try {
    assert.equal((await app.inject('/api/private')).statusCode, 401);
    assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload:{password:process.env.APP_PASSWORD}})).statusCode, 403);
    assert.equal((await app.inject({method:'POST',url:'/api/auth/login',headers:{...headers,origin:'https://untrusted.example'},payload:{password:process.env.APP_PASSWORD}})).statusCode, 403);
    assert.equal((await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{password:'incorrect'}})).statusCode, 401);
    const login = await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{password:process.env.APP_PASSWORD}});
    assert.equal(login.statusCode,200);
    const cookie=login.headers['set-cookie'].split(';')[0];
    assert.equal((await app.inject({url:'/api/private',headers:{cookie}})).statusCode,200);
    const handshake=(cookieValue,origin=process.env.APP_ORIGIN) => new Promise(resolve => socketAuthentication(app)({handshake:{headers:{cookie:cookieValue,origin}},data:{}},resolve));
    assert.ok(await handshake(''));
    assert.ok(await handshake('sendmidia_session=invalid'));
    assert.ok(await handshake(cookie,'https://untrusted.example'));
    assert.equal(await handshake(cookie),undefined);
    const expired=app.createSecureSession({authenticated:true,issuedAt:Date.now()-3600001,passwordVersion:'invalid'});
    assert.equal(sessionIsValid(expired),false);
    const previous=process.env.APP_PASSWORD;
    process.env.APP_PASSWORD=randomBytes(24).toString('hex');
    assert.equal((await app.inject({url:'/api/private',headers:{cookie}})).statusCode,401);
    assert.ok(await handshake(cookie));
    process.env.APP_PASSWORD=previous;
    assert.equal((await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie}})).statusCode,200);
    assert.ok((await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie}})).headers['set-cookie'].includes('Max-Age=0'));
  } finally { await app.close(); }
});

test('limite de tentativas, expiração da janela e bloqueio de integrações', () => {
  const allow=createLoginLimiter();
  for(let i=0;i<10;i++) assert.equal(allow('client',1000),true);
  assert.equal(allow('client',1000),false);
  assert.equal(allow('another-client',1000),true);
  assert.equal(allow('client',901001),true);
  assert.equal(EXTERNAL_INTEGRATIONS_ENABLED,false);
  assert.throws(requireExternalIntegration,{code:'portfolio_mode'});
});
