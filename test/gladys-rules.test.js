// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the real answers of slskd 0.26.2): idle, downloading and
// uploading, off the Soulseek network, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, createAll, createWorld } from './helpers/world.js';
import { FakeSlskd, fixtureJson } from './helpers/fakeSlskd.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const recorded = (path) =>
  fixtureJson(path).flatMap((user) => user.directories.flatMap((directory) => directory.files));

const scenarios = [
  { label: 'idle, real completed list', config: CONFIG, setup: () => {} },
  {
    label: 'downloading and uploading (real transfers), French names',
    config: { ...CONFIG, language: 'fr' },
    setup: (w) => {
      w.slskd.downloads.push(...recorded('0.26.2/downloads-in-progress.json'));
      w.slskd.downloads.push(...recorded('0.26.2/downloads-errored.json'));
      w.slskd.addDownload({ state: 'Queued, Remotely', percent: 0, speed: 0 });
      w.slskd.addUpload();
    },
  },
  {
    label: 'off the Soulseek network, German names',
    config: { ...CONFIG, language: 'de' },
    setup: (w) => w.slskd.setConnected(false),
  },
  { label: 'Spanish names', config: { ...CONFIG, language: 'es' }, setup: () => {} },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const w = await createWorld({ config: scenario.config, slskd: new FakeSlskd() });
    try {
      scenario.setup(w);
      await createAll(w);
      await w.hub.pollAll();
      const devices = w.fake.discoveredDevices;
      assert.equal(devices.length, 1);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = w.fake.lastState(feature.external_id);
          if (feature.category === 'text') {
            assert.ok(typeof value === 'string' && value.length > 0, `${at}: empty text`);
            continue;
          }
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await w.app.stop();
    }
  });
}
