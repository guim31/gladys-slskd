// -----------------------------------------------------------------------------
// The `downloads` dashboard widget: content within the core budget (checked
// with the SDK's validator), its rows, its button and its action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_FILE_ROWS, formatDuration } from '../src/widgets.js';
import { CONFIG, createWorld } from './helpers/world.js';

async function world(t, config = CONFIG) {
  const w = await createWorld({ config });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, language = 'en') {
  // Every language within the budget (labels are cut beyond their length).
  for (const other of ['en', 'fr', 'de', 'es']) {
    const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: other });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(validateWidgetContent(ack.data.content), [], `budget (${other})`);
  }
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
  return ack.data.content;
}

const ofType = (tree, type) => tree.components.filter((component) => component.type === type);

test('downloading: speed, downloads, time left, one row per file, no button by default', async (t) => {
  const w = await world(t);
  w.slskd.addDownload({ name: 'A.flac', percent: 75, speed: 1024 * 1024, remaining: '00:02:00' });
  w.slskd.addDownload({ name: 'B.flac', percent: 10, speed: 512 * 1024, remaining: '01:10:00' });
  w.slskd.addDownload({ state: 'Queued, Remotely', percent: 0, speed: 0 });
  w.slskd.addUpload();
  await w.hub.pollAll();
  const tree = await content(w);
  assert.deepEqual(
    ofType(tree, 'value').map(({ label, value, unit }) => [label, value, unit]),
    [
      ['Speed', 1.5, 'MB/s'],
      ['Downloads', 2, undefined],
      ['Time left', '1 h 10', undefined],
    ],
  );
  assert.deepEqual(
    ofType(tree, 'status')[0].items.map(({ label, value }) => [label, value]),
    [
      ['Soulseek', 'Downloading'],
      ['A.flac', '75 % · 2 min'],
      ['B.flac', '10 % · 1 h 10'],
      ['Downloads waiting', 1],
      ['Failed downloads', 1],
      ['Uploads in progress', 1],
      ['Last download', 'gladys-test-free-noise.bin'],
    ],
  );
  assert.equal(ofType(tree, 'button').length, 0, 'clearing is off by default');
  assert.equal(tree.ttl_seconds, 15, 'refreshed sooner while downloading');
});

test('many downloads: the rows stay within the budget', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 12; i += 1) {
    w.slskd.addDownload({ name: `${'Long name '.repeat(6)}${i}.flac`, percent: i });
  }
  await w.hub.pollAll();
  const tree = await content(w, 'fr');
  const rows = ofType(tree, 'status')[0].items;
  assert.equal(rows.filter((row) => row.icon === 'arrow-down-circle').length, MAX_FILE_ROWS);
  assert.ok(rows.every((row) => row.label.length <= 40 && String(row.value).length <= 40));
});

test('the clear button when allowed, and its toast', async (t) => {
  const w = await world(t, { ...CONFIG, allow_clear: true });
  const tree = await content(w, 'fr');
  const [button] = ofType(tree, 'button');
  assert.equal(button.label, 'Vider les terminés');
  assert.equal(button.action.key, ACTIONS.CLEAR);
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.CLEAR, {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.fr, /^3 téléchargement\(s\) terminé\(s\) retiré\(s\)/);
  assert.equal(w.slskd.downloads.length, 0);
});

test('slskd unreachable, off the network, not configured', async (t) => {
  const w = await world(t);
  w.slskd.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  const down = await content(w);
  assert.equal(ofType(down, 'value').length, 0);
  assert.deepEqual(
    ofType(down, 'status')[0].items.map(({ label, value }) => [label, value]),
    [['Soulseek', 'slskd does not answer']],
  );
  w.slskd.online = true;
  w.slskd.setConnected(false);
  await w.hub.pollAll();
  const off = await content(w, 'de');
  assert.equal(ofType(off, 'status')[0].items[0].value, 'Soulseek getrennt');
  const empty = await world(t, { language: 'es' });
  const nothing = await content(empty, 'es');
  assert.match(nothing.components[0].text, /Introduzca la dirección de slskd/);
});

test('durations fit a tile', () => {
  assert.equal(formatDuration(20, 'en'), '1 min');
  assert.equal(formatDuration(3600, 'fr'), '1 h 00');
  assert.equal(formatDuration(3 * 86_400 + 7200, 'fr'), '3 j 2 h');
});
