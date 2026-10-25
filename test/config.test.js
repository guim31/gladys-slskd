// -----------------------------------------------------------------------------
// Configuration: the address as people type it, defaults, bad values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address as people type it', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:5030');
  assert.equal(parseServerUrl(' nas.local:5030 '), 'http://nas.local:5030');
  assert.equal(parseServerUrl('http://192.0.2.10:5030/downloads'), 'http://192.0.2.10:5030');
  assert.equal(parseServerUrl('https://slskd.example.com/'), 'https://slskd.example.com');
  assert.equal(parseServerUrl('https://example.com/slskd/api/v0'), 'https://example.com/slskd');
  assert.equal(parseServerUrl('http://example.com/slskd/searches'), 'http://example.com/slskd');
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl('http://user:pass@192.0.2.10'), null, 'no credentials in the URL');
  assert.equal(parseServerUrl('http://'), null);
  assert.equal(parseServerUrl(''), null);
  assert.equal(parseServerUrl(42), null);
});

test('defaults: nothing configured, French, 30 seconds, clearing off', () => {
  const config = normalizeConfig({});
  assert.equal(config.server, null);
  assert.equal(config.invalidUrl, false);
  assert.equal(config.language, 'fr');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.allowClear, false);
  assert.equal(config.allowSelfSigned, false);
  assert.deepEqual(normalizeConfig(null), config);
});

test('a full configuration, and values out of the lists', () => {
  const config = normalizeConfig({
    url: '192.0.2.10',
    api_key: '  key-with-spaces-around  ',
    name: '  Soulseek  ',
    allow_clear: 'true',
    poll_interval: 120,
    language: 'it',
  });
  assert.deepEqual(config.server, {
    url: 'http://192.0.2.10:5030',
    apiKey: 'key-with-spaces-around',
    name: 'Soulseek',
  });
  assert.equal(config.allowClear, true);
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 30_000);
  assert.equal(normalizeConfig({ url: 'ftp://x' }).invalidUrl, true);
  assert.equal(normalizeConfig({ url: '192.0.2.10', name: 'x'.repeat(80) }).server.name.length, 40);
});
