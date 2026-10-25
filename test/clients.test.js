// -----------------------------------------------------------------------------
// The slskd client and its snapshot, on the real answers of slskd 0.26.2
// (test/fixtures/slskd): transfer states, speeds, remaining times, errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/clients/errors.js';
import {
  STATUSES,
  baseName,
  timeSpanSeconds,
  toSnapshot,
  transferKind,
} from '../src/clients/model.js';
import { SlskdClient } from '../src/clients/slskd.js';
import { API_KEY, FakeSlskd, createNetwork, fixtureJson } from './helpers/fakeSlskd.js';

const URL_BASE = 'http://192.0.2.10:5030';

function client(slskd = new FakeSlskd(), apiKey = API_KEY) {
  const network = createNetwork({ [URL_BASE]: slskd });
  return new SlskdClient({ url: URL_BASE, apiKey, request: network.request });
}

test('transfer states: completed, failed, cancelled, active, waiting', () => {
  assert.equal(transferKind('Completed, Succeeded'), 'succeeded');
  assert.equal(transferKind('Completed, Rejected'), 'failed');
  assert.equal(transferKind('Completed, Errored'), 'failed');
  assert.equal(transferKind('Completed, TimedOut'), 'failed');
  assert.equal(transferKind('Completed, Aborted'), 'failed');
  assert.equal(transferKind('Completed, Cancelled'), 'cancelled');
  assert.equal(transferKind('InProgress'), 'active');
  assert.equal(transferKind('Initializing'), 'active');
  assert.equal(transferKind('Queued, Locally'), 'queued');
  assert.equal(transferKind('Queued, Remotely'), 'queued');
  assert.equal(transferKind('Requested'), 'queued');
  assert.equal(transferKind(undefined), 'queued');
});

test('time spans and file names', () => {
  assert.equal(timeSpanSeconds('00:00:20.4660512'), 20);
  assert.equal(timeSpanSeconds('1.02:03:04'), 93_784);
  assert.equal(timeSpanSeconds('-00:00:00.0049923'), 0, 'negative between two attempts');
  assert.equal(timeSpanSeconds(undefined), 0);
  assert.equal(baseName('Music\\Artist\\01 - Song.flac'), '01 - Song.flac');
  assert.equal(baseName('share/file.txt'), 'file.txt');
  assert.equal(baseName(''), '');
});

test('the real completed list: two succeeded, one refused by the peer', () => {
  const snapshot = toSnapshot({
    application: fixtureJson('0.26.2/application.json'),
    downloads: fixtureJson('0.26.2/downloads-completed.json'),
    uploads: fixtureJson('0.26.2/uploads-in-progress.json'),
  });
  assert.equal(snapshot.version, '0.26.2.0');
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.status, STATUSES.IDLE);
  assert.deepEqual(
    snapshot.succeeded.map((file) => [file.name, file.user, file.bytes]),
    [
      ['gladys-test-free-noise.bin', 'gladys-test-b', 3_000_000],
      ['gladys-test-free-file.txt', 'gladys-test-b', 46],
    ],
    'newest first',
  );
  assert.deepEqual(snapshot.failed, [
    {
      id: '1fead4c5-5a8b-4ea1-b428-b3a4c8363c9d',
      name: 'missing-file.flac',
      user: 'gladys-test-b',
      reason: 'Transfer rejected: File not shared.',
    },
  ]);
  assert.equal(snapshot.pendingCount, 0);
  assert.equal(snapshot.downloadSpeedBps, 0, 'completed transfers are not counted');
  assert.equal(snapshot.activeUploads, 1, 'the real upload in progress');
  assert.equal(Math.round(snapshot.uploadSpeedBps), 173_303);
});

test('the real download in progress, and the real one errored after three attempts', () => {
  const progress = toSnapshot({
    application: fixtureJson('0.26.2/application.json'),
    downloads: fixtureJson('0.26.2/downloads-in-progress.json'),
    uploads: [],
  });
  assert.equal(progress.status, STATUSES.DOWNLOADING);
  assert.equal(progress.activeDownloads, 1);
  assert.equal(Math.round(progress.downloadSpeedBps), 96_351);
  assert.deepEqual(
    progress.downloads.map((file) => [file.name, file.percent, file.etaSec]),
    [['gladys-test-free-noise.bin', 34, 20]],
  );
  assert.equal(progress.timeLeftSec, 20);
  const errored = toSnapshot({
    application: fixtureJson('0.26.2/application.json'),
    downloads: fixtureJson('0.26.2/downloads-errored.json'),
    uploads: [],
  });
  assert.equal(errored.failed[0].reason, 'User gladys-test-b appears to be offline');
  assert.equal(errored.downloadSpeedBps, 0, 'a negative average speed is not a speed');
  // Between two attempts: back to "Queued, Locally", with the exception.
  const retrying = toSnapshot({
    application: fixtureJson('0.26.2/application.json'),
    downloads: fixtureJson('0.26.2/downloads-retrying.json'),
    uploads: [],
  });
  assert.deepEqual([retrying.failed.length, retrying.queuedDownloads], [0, 1]);
  assert.equal(retrying.status, STATUSES.QUEUED);
});

test('off the Soulseek network: the recorded "Disconnected" state', () => {
  const snapshot = toSnapshot({
    application: fixtureJson('0.26.2/application-disconnected.json'),
    downloads: [],
    uploads: [],
  });
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.status, STATUSES.DISCONNECTED);
});

test('a reading costs three calls, with the key in X-API-Key', async () => {
  const slskd = new FakeSlskd();
  const snapshot = await client(slskd).read();
  assert.equal(snapshot.succeeded.length, 2);
  assert.deepEqual(slskd.calls.sort(), [
    'GET application',
    'GET transfers/downloads',
    'GET transfers/uploads',
  ]);
});

test('authentication off: no key needed', async () => {
  const snapshot = await client(new FakeSlskd({ apiKey: null }), '').read();
  assert.equal(snapshot.connected, true);
});

test('errors by kind: key, role, address, network, redirect, HTML', async () => {
  const kind = (promise) =>
    promise.then(
      () => 'no error',
      (err) => err.kind,
    );
  assert.equal(await kind(client(new FakeSlskd(), 'wrong').read()), ERROR_KINDS.AUTH);
  const forbidden = new FakeSlskd();
  forbidden.forbidden.add('transfers/downloads/all/completed');
  assert.equal(await kind(client(forbidden).clearCompletedDownloads()), ERROR_KINDS.PERMISSION);
  const down = new FakeSlskd();
  down.online = false;
  assert.equal(await kind(client(down).read()), ERROR_KINDS.UNREACHABLE);
  const elsewhere = new SlskdClient({
    url: URL_BASE,
    request: createNetwork({}).request,
  });
  assert.equal(await kind(elsewhere.read()), ERROR_KINDS.UNREACHABLE);
  const respond = (response) =>
    new SlskdClient({ url: URL_BASE, request: async () => response }).read();
  assert.equal(
    await kind(respond({ status: 301, headers: { location: 'https://x.example/?k=1' }, body: '' })),
    ERROR_KINDS.REDIRECT,
  );
  assert.equal(
    await kind(respond({ status: 200, headers: {}, body: '<!doctype html>' })),
    ERROR_KINDS.NOT_SLSKD,
  );
  assert.equal(await kind(respond({ status: 404, headers: {}, body: '' })), ERROR_KINDS.NOT_SLSKD);
  assert.equal(await kind(respond({ status: 500, headers: {}, body: '' })), ERROR_KINDS.HTTP);
  assert.equal(
    await kind(respond({ status: 200, headers: {}, body: '{"other":1}' })),
    ERROR_KINDS.NOT_SLSKD,
  );
  const tls = new SlskdClient({
    url: 'https://192.0.2.10:5031',
    request: async () => {
      const error = new Error('self-signed');
      error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
      throw error;
    },
  });
  assert.equal(await kind(tls.read()), ERROR_KINDS.TLS);
});

test('clearing the completed downloads removes them from the list only', async () => {
  const slskd = new FakeSlskd();
  slskd.addDownload();
  await client(slskd).clearCompletedDownloads();
  assert.deepEqual(
    slskd.downloads.map((file) => file.state),
    ['InProgress'],
  );
});
