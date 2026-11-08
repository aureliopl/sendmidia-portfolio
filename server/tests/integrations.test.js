import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, createGroup, restoreSessions } from '../src/whatsapp/manager.js';
import { startWorker, sendToJid } from '../src/whatsapp/worker.js';
import { fetchOgPreview } from '../src/utils/linkPreview.js';
import { enviarTelegram, enviarEmail } from '../src/alerts/channels.js';

test('os pontos de entrada reais não conectam nem enviam na edição pública', async () => {
  await assert.rejects(startSession('demo-account'), { code: 'portfolio_mode' });
  await assert.rejects(createGroup('demo-account', 'Demo'), { code: 'portfolio_mode' });
  await assert.rejects(restoreSessions(), { code: 'portfolio_mode' });
  await assert.rejects(sendToJid('demo-account', 'demo', {}), { code: 'portfolio_mode' });
  assert.throws(startWorker, { code: 'portfolio_mode' });
  assert.equal(await fetchOgPreview('https://example.com'), null);
  assert.equal(await enviarTelegram('demo'), false);
  assert.equal(await enviarEmail('demo', 'demo'), false);
});
