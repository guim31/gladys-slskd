// -----------------------------------------------------------------------------
// The slskd hub against the SDK's fake Gladys and an in-memory slskd: device,
// states, scene events, outages, the container timer, scene actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { MAX_EVENTS_PER_READING, TRIGGERS } from '../src/hub.js';
import { CONFIG, FakeSlskd, createAll, createWorld, deviceId, featureId } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('one device, published with should_poll false, named after the configuration', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => [device.name, device.should_poll, device.params]),
    [['Soulseek', false, [{ name: 'URL', value: 'http://192.0.2.10:5030' }]]],
  );
  assert.equal(w.fake.discoveredDevices[0].external_id, deviceId(w.gladys));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('no address: no device, a message under the integration name', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address of slskd/);
  const bad = await world(t, { config: { url: 'ftp://192.0.2.10' } });
  assert.match(bad.fake.connectionStatus.message.fr, /Adresse incomprise/);
});

test('states only once the device is added, all of them then', async (t) => {
  const w = await world(t);
  w.slskd.addDownload({ name: 'Track.flac', speed: 512 * 1024 });
  w.slskd.addUpload();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, 0, 'nothing before the device exists');
  await createAll(w);
  const value = (key) => w.fake.lastState(featureId(w.gladys, key));
  assert.equal(value(FEATURE_KEYS.DOWNLOAD_SPEED), 512);
  assert.equal(value(FEATURE_KEYS.UPLOAD_SPEED), 100);
  assert.equal(value(FEATURE_KEYS.ACTIVE), 1);
  assert.equal(value(FEATURE_KEYS.QUEUED), 0);
  assert.equal(value(FEATURE_KEYS.COMPLETED), 2);
  assert.equal(value(FEATURE_KEYS.FAILED), 1);
  assert.equal(value(FEATURE_KEYS.UPLOADS), 1);
  assert.equal(value(FEATURE_KEYS.STATUS), 'Downloading');
  assert.equal(value(FEATURE_KEYS.LAST), 'gladys-test-free-noise.bin', 'newest at start');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.ok(w.fake.widgetRefreshes.length > 0, 'the widget is refreshed');
});

test('only the changes are sent', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');
  w.slskd.addDownload({ state: 'Queued, Remotely', speed: 0, percent: 0 });
  await w.hub.pollAll();
  const sent = w.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.deepEqual(sent.map((id) => id.split(':').at(-1)).sort(), ['queued_downloads', 'status']);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Waiting');
});

test('a completed download fires once, with its details, and becomes the last download', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'the list read at start is not announced');
  const id = w.slskd.addDownload({ name: '01 - Song.flac', user: 'peer', size: 31_457_280 });
  await w.hub.pollAll();
  w.slskd.complete(id);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.COMPLETED), [
    {
      key: TRIGGERS.COMPLETED,
      data: { name: '01 - Song.flac', user: 'peer', size_mb: 30 },
    },
  ]);
  assert.deepEqual(events(w, TRIGGERS.QUEUE_EMPTY).length, 1, 'nothing left to download');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.LAST)), '01 - Song.flac');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.COMPLETED)), 3);
});

test('the same file downloaded again is a new transfer, announced again', async (t) => {
  const w = await world(t);
  const first = w.slskd.addDownload({ name: 'Same.flac' });
  await w.hub.pollAll();
  w.slskd.complete(first);
  await w.hub.pollAll();
  // slskd replaces the old transfer of the same file by a new one.
  w.slskd.downloads = w.slskd.downloads.filter((file) => file.id !== first);
  const second = w.slskd.addDownload({ name: 'Same.flac' });
  await w.hub.pollAll();
  w.slskd.complete(second);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.COMPLETED).length, 2);
});

test('a failed download fires once with the reason; a cancelled one does not', async (t) => {
  const w = await world(t);
  const refused = w.slskd.addDownload({ name: 'Refused.mp3', user: 'peer' });
  const cancelled = w.slskd.addDownload({ name: 'Cancelled.mp3' });
  const other = w.slskd.addDownload({ name: 'Other.mp3' });
  await w.hub.pollAll();
  w.slskd.fail(refused);
  w.slskd.fail(cancelled, 'Cancelled', 'Completed, Cancelled');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.FAILED), [
    {
      key: TRIGGERS.FAILED,
      data: { name: 'Refused.mp3', user: 'peer', reason: 'Transfer rejected: File not shared.' },
    },
  ]);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 0, 'one is still downloading');
  w.slskd.fail(other, 'Transfer timed out', 'Completed, TimedOut');
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.FAILED).length, 2);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 1);
});

test('the Soulseek network: lost on two readings in a row, back at once', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.slskd.setConnected(false);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.NETWORK_LOST).length, 0, 'a reconnection takes a few seconds');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Soulseek disconnected');
  w.slskd.setConnected(true);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.NETWORK_RESTORED).length, 0, 'a blip is not announced');
  w.slskd.setConnected(false);
  await w.hub.pollAll();
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.NETWORK_LOST).length, 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true }, 'slskd itself answers');
  w.slskd.setConnected(true);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.NETWORK_RESTORED).length, 1);
});

test('after a restart, what happened meanwhile is announced, not the rest', async (t) => {
  const first = await world(t);
  const id = first.slskd.addDownload({ name: 'While away.flac' });
  await first.hub.pollAll();
  await first.app.stop();
  first.slskd.complete(id);
  const second = await world(t, { slskd: first.slskd, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.name]),
    [
      [TRIGGERS.COMPLETED, 'While away.flac'],
      [TRIGGERS.QUEUE_EMPTY, undefined],
    ],
  );
});

test('slskd down: unreachable after two readings, then back', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.slskd.online = false;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true }, 'one blip is not an outage');
  await w.hub.pollAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.en, 'slskd does not answer');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Unreachable');
  assert.equal(events(w, TRIGGERS.NETWORK_LOST).length, 0, 'not the Soulseek network');
  w.slskd.online = true;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Idle');
});

test('a refused key: said at once, not retried on the timer, retried on a new configuration', async (t) => {
  const w = await world(t, { config: { ...CONFIG, api_key: 'wrong-key-0123456789' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /clé d'API refusée/);
  const calls = w.slskd.calls.length;
  await w.hub.pollAll();
  assert.equal(w.slskd.calls.length, calls, 'no new call');
  await w.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the container reads slskd on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { config: { ...CONFIG, poll_interval: '10' }, timers: true });
  const readings = () => w.slskd.calls.filter((call) => call === 'GET application').length;
  assert.equal(readings(), 1);
  t.mock.timers.tick(10_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readings(), 2);
  t.mock.timers.tick(10_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readings(), 3);
});

test('read the summary: a sentence and the figures', async (t) => {
  const w = await world(t);
  w.slskd.addDownload({ speed: 2.5 * 1024 * 1024 });
  w.slskd.addDownload({ state: 'Queued, Remotely', speed: 0 });
  const ack = await w.fake.sceneAction('read_summary', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    summary:
      'Soulseek: connected to Soulseek, 1 download(s) in progress, 1 waiting (2.5 MB/s), 1 failed',
    connected: 1,
    downloading: 1,
    waiting: 1,
    failed: 1,
  });
});

test('clear the completed downloads: off by default, then the list only', async (t) => {
  const off = await world(t);
  const refused = await off.fake.sceneAction('clear_completed', {});
  assert.equal(refused.success, false);
  assert.match(refused.error, /clearing is off/);
  assert.ok(!off.slskd.calls.some((call) => call.startsWith('DELETE')));

  const w = await world(t, { config: { ...CONFIG, allow_clear: true } });
  await createAll(w);
  w.slskd.addDownload();
  const ack = await w.fake.sceneAction('clear_completed', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { cleared: 3 });
  assert.equal(w.slskd.downloads.length, 1, 'the download in progress stays');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.COMPLETED)), 0);
  assert.equal(events(w, TRIGGERS.COMPLETED).length + events(w, TRIGGERS.FAILED).length, 0);

  const forbidden = new FakeSlskd();
  forbidden.forbidden.add('transfers/downloads/all/completed');
  const ro = await world(t, { config: { ...CONFIG, allow_clear: true }, slskd: forbidden });
  const denied = await ro.fake.sceneAction('clear_completed', {});
  assert.equal(denied.success, false);
  assert.match(denied.error, /use readwrite/);
  assert.deepEqual(ro.fake.connectionStatus, { connected: true }, 'the reading still works');
});

test('test the connection: version and state, or the reason', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'OK, slskd 0.26.2.0. Soulseek: connected to Soulseek, no download in progress, 1 failed',
  );
  w.slskd.online = false;
  const down = await w.fake.action('test_connection', {});
  assert.match(down.data.message.de, /Soulseek: slskd antwortet nicht/);
});

test('an event Gladys refuses is sent again at the next reading, not lost', async (t) => {
  const w = await world(t);
  const id = w.slskd.addDownload({ name: 'Retry.flac' });
  await w.hub.pollAll();
  w.slskd.complete(id);
  const original = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (key, data) => {
    if (refuse) {
      throw new Error('Gladys is restarting');
    }
    return original(key, data);
  });
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.COMPLETED).length, 0);
  refuse = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.name]),
    [
      [TRIGGERS.COMPLETED, 'Retry.flac'],
      [TRIGGERS.QUEUE_EMPTY, undefined],
    ],
  );
});

test('a burst of failures goes out over several readings, each file once', async (t) => {
  const w = await world(t);
  const ids = Array.from({ length: MAX_EVENTS_PER_READING + 10 }, (_, i) =>
    w.slskd.addDownload({ name: `${i}.flac` }),
  );
  await w.hub.pollAll();
  for (const id of ids) {
    w.slskd.fail(id, 'User peer appears to be offline', 'Completed, Errored');
  }
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.FAILED).length, MAX_EVENTS_PER_READING);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 0, 'not before every file is announced');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.FAILED).length, ids.length);
  assert.equal(new Set(events(w, TRIGGERS.FAILED).map((e) => e.data.name)).size, ids.length);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 1);
});

test('a download started and ended between two readings still empties the queue', async (t) => {
  const w = await world(t);
  const id = w.slskd.addDownload({ name: 'Quick.flac' });
  w.slskd.complete(id);
  // The first reading at start saw it already completed: start from a clean list.
  w.slskd.downloads = w.slskd.downloads.filter((file) => file.id !== id);
  await w.hub.pollAll();
  w.slskd.downloads.push({ ...w.slskd.downloads[0], id: 'quick-id', filename: 'x\\Quick.flac' });
  w.slskd.downloads.at(-1).state = 'Completed, Succeeded';
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.COMPLETED).length, 1);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 1);
});

test('Gladys refusing the devices at start does not stop the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { connect: false, timers: true });
  t.mock.method(w.gladys, 'publishDiscoveredDevices', async () => {
    throw new Error('503');
  });
  await w.gladys.connect();
  await w.app.ready;
  assert.ok(w.hub.pollTimer, 'the next reading is scheduled');
});

test('slskd down: nothing moving, "Unreachable" kept fresh; a too long list is said', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.slskd.addDownload({ speed: 1024 * 1024 });
  await w.hub.pollAll();
  w.slskd.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.DOWNLOAD_SPEED)), 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.ACTIVE)), 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.COMPLETED)), 2, 'unknown, kept');
  w.slskd.online = true;
  const big = new FakeSlskd();
  big.handle = async (url, options) => {
    if (url.endsWith('transfers/downloads')) {
      const error = new Error('Response too large');
      error.code = 'ERESPONSETOOLARGE';
      throw error;
    }
    return FakeSlskd.prototype.handle.call(big, url, options);
  };
  const huge = await world(t, { slskd: big });
  assert.match(huge.fake.connectionStatus.message.en, /transfer list too long/);
});
