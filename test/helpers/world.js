// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake slskd on a fake
// network and a temporary /data, with the integration wired on top through
// registerHandlers. No timer runs unless `timers: true`: the tests read slskd
// with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, FakeSlskd, createNetwork } from './fakeSlskd.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const SLSKD_URL = 'http://192.0.2.10:5030';

export const CONFIG = {
  url: '192.0.2.10',
  api_key: API_KEY,
  name: 'Soulseek',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeSlskd} [options.slskd]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  slskd = new FakeSlskd(),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-slskd-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork({ [SLSKD_URL]: slskd });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, slskd, app, hub: app.hub, dataDir };
}

export const deviceId = (gladys) => gladys.externalIds('client', '1').device;
export const featureId = (gladys, key) => gladys.externalIds('client', '1').feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeSlskd };
