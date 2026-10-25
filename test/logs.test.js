// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the API key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createAll, createWorld } from './helpers/world.js';
import { API_KEY } from './helpers/fakeSlskd.js';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading writes nothing at the info level', async (t) => {
  const w = await world(t);
  await createAll(w);
  const logs = captureLogs(t);
  const id = w.slskd.addDownload();
  await w.hub.pollAll();
  w.slskd.complete(id);
  await w.hub.pollAll();
  await w.hub.pollAll();
  await w.fake.widgetGet('downloads', { settings: {}, language: 'fr' });
  assert.deepEqual(logs.texts(), []);
});

test('slskd down: one warning, one line when it is back, never the key', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.slskd.online = false;
  for (let i = 0; i < 4; i += 1) {
    await w.hub.pollAll();
  }
  w.slskd.online = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  const texts = logs.texts();
  assert.equal(texts.filter((text) => /ECONNREFUSED/.test(text)).length, 1, texts.join('\n'));
  assert.equal(texts.filter((text) => /answers again/.test(text)).length, 1, texts.join('\n'));
  assert.equal(texts.length, 2, texts.join('\n'));
});

test('a refused key: one warning, no retry on the timer, the key never logged', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...CONFIG, api_key: 'wrong-key-0123456789' } });
  await w.hub.pollAll();
  await w.hub.pollAll();
  const texts = logs.texts();
  assert.equal(texts.filter((text) => /API key refused/.test(text)).length, 1, texts.join('\n'));
  assert.equal(w.slskd.calls.filter((call) => call === 'GET application').length, 1);
  for (const text of texts) {
    assert.ok(!text.includes('wrong-key-0123456789') && !text.includes(API_KEY), text);
  }
});

test('the network lost and back: one line each', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.slskd.setConnected(false);
  await w.hub.pollAll();
  await w.hub.pollAll();
  await w.hub.pollAll();
  w.slskd.setConnected(true);
  await w.hub.pollAll();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*slskd \(/, 'slskd (')),
    ['slskd (Soulseek): Soulseek network lost', 'slskd (Soulseek): Soulseek network back'],
  );
});
