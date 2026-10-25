// -----------------------------------------------------------------------------
// One Gladys device: the slskd client.
//
// Identity: a fixed id (one slskd per integration), not the address: an IP
// changed for a host name, or HTTP for HTTPS, keeps the device and its
// history. slskd exposes no stable instance id to use instead.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), all read-only, in display order:
//   - Soulseek network: switch/binary is a control, so the connection is
//     told by the status text, the badge and the two network triggers; no
//     binary feature;
//   - download and upload speed: datarate/rate in KB/s (binary kilobytes,
//     like slskd shows them);
//   - downloads in progress, waiting, completed and failed (the list slskd
//     keeps until it is cleared), uploads in progress:
//     counter-sensor/integer;
//   - status: text/text (Downloading, Waiting, Idle, Soulseek disconnected,
//     Unreachable), in the language of the configuration;
//   - last download: text/text, the name of the last file completed.
//
// Published with should_poll: false: the integration reads slskd on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { KB } from './clients/model.js';
import { STATUS_TEXT, pick } from './texts.js';

export const DEVICE_TYPE = 'client';
export const DEVICE_ID = '1';
export const URL_PARAM = 'URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  DOWNLOAD_SPEED: 'download_speed',
  UPLOAD_SPEED: 'upload_speed',
  ACTIVE: 'active_downloads',
  QUEUED: 'queued_downloads',
  COMPLETED: 'completed_downloads',
  FAILED: 'failed_downloads',
  UPLOADS: 'active_uploads',
  STATUS: 'status',
  LAST: 'last_completed',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.DOWNLOAD_SPEED]: 'Download speed',
    [FEATURE_KEYS.UPLOAD_SPEED]: 'Upload speed',
    [FEATURE_KEYS.ACTIVE]: 'Downloads in progress',
    [FEATURE_KEYS.QUEUED]: 'Downloads waiting',
    [FEATURE_KEYS.COMPLETED]: 'Downloads completed',
    [FEATURE_KEYS.FAILED]: 'Downloads failed',
    [FEATURE_KEYS.UPLOADS]: 'Uploads in progress',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Last download',
  },
  fr: {
    [FEATURE_KEYS.DOWNLOAD_SPEED]: 'Vitesse de téléchargement',
    [FEATURE_KEYS.UPLOAD_SPEED]: "Vitesse d'envoi",
    [FEATURE_KEYS.ACTIVE]: 'Téléchargements en cours',
    [FEATURE_KEYS.QUEUED]: 'Téléchargements en attente',
    [FEATURE_KEYS.COMPLETED]: 'Téléchargements terminés',
    [FEATURE_KEYS.FAILED]: 'Téléchargements en échec',
    [FEATURE_KEYS.UPLOADS]: 'Envois en cours',
    [FEATURE_KEYS.STATUS]: 'État',
    [FEATURE_KEYS.LAST]: 'Dernier téléchargement',
  },
  de: {
    [FEATURE_KEYS.DOWNLOAD_SPEED]: 'Download-Geschwindigkeit',
    [FEATURE_KEYS.UPLOAD_SPEED]: 'Upload-Geschwindigkeit',
    [FEATURE_KEYS.ACTIVE]: 'Laufende Downloads',
    [FEATURE_KEYS.QUEUED]: 'Wartende Downloads',
    [FEATURE_KEYS.COMPLETED]: 'Abgeschlossene Downloads',
    [FEATURE_KEYS.FAILED]: 'Fehlgeschlagene Downloads',
    [FEATURE_KEYS.UPLOADS]: 'Laufende Uploads',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Letzter Download',
  },
  es: {
    [FEATURE_KEYS.DOWNLOAD_SPEED]: 'Velocidad de descarga',
    [FEATURE_KEYS.UPLOAD_SPEED]: 'Velocidad de subida',
    [FEATURE_KEYS.ACTIVE]: 'Descargas en curso',
    [FEATURE_KEYS.QUEUED]: 'Descargas en espera',
    [FEATURE_KEYS.COMPLETED]: 'Descargas completadas',
    [FEATURE_KEYS.FAILED]: 'Descargas fallidas',
    [FEATURE_KEYS.UPLOADS]: 'Subidas en curso',
    [FEATURE_KEYS.STATUS]: 'Estado',
    [FEATURE_KEYS.LAST]: 'Última descarga',
  },
};

// Display bounds (the core never applies them on write).
const sensor = (category, type, extra) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  ...extra,
});
const MAX_FILES = 1_000_000;
const MAX_KBPS = 10_000_000;
const counter = () =>
  sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
    max: MAX_FILES,
  });
const rate = () =>
  sensor(DEVICE_FEATURE_CATEGORIES.DATARATE, DEVICE_FEATURE_TYPES.DATARATE.RATE, {
    unit: DEVICE_FEATURE_UNITS.KILOBYTES_PER_SECOND,
    max: MAX_KBPS,
  });
const textFeature = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 0,
};
const kbps = (bytes) => Math.min(MAX_KBPS, Math.round(bytes / KB));
const files = (value) => Math.min(MAX_FILES, value);

// Order = display order in Gladys. `value(snapshot, context)` returns a number,
// `{ text }` or null (nothing to publish).
const FEATURES = [
  {
    key: FEATURE_KEYS.DOWNLOAD_SPEED,
    definition: rate(),
    value: (snapshot) => kbps(snapshot.downloadSpeedBps),
  },
  {
    key: FEATURE_KEYS.UPLOAD_SPEED,
    definition: rate(),
    value: (snapshot) => kbps(snapshot.uploadSpeedBps),
  },
  {
    key: FEATURE_KEYS.ACTIVE,
    definition: counter(),
    value: (snapshot) => files(snapshot.activeDownloads),
  },
  {
    key: FEATURE_KEYS.QUEUED,
    definition: counter(),
    value: (snapshot) => files(snapshot.queuedDownloads),
  },
  {
    key: FEATURE_KEYS.COMPLETED,
    definition: counter(),
    value: (snapshot) => files(snapshot.succeeded.length),
  },
  {
    key: FEATURE_KEYS.FAILED,
    definition: counter(),
    value: (snapshot) => files(snapshot.failed.length),
  },
  {
    key: FEATURE_KEYS.UPLOADS,
    definition: counter(),
    value: (snapshot) => files(snapshot.activeUploads),
  },
  {
    key: FEATURE_KEYS.STATUS,
    definition: textFeature,
    value: (snapshot, { language }) => ({ text: pick(STATUS_TEXT[snapshot.status], language) }),
  },
  {
    key: FEATURE_KEYS.LAST,
    definition: textFeature,
    value: (snapshot, { lastCompleted }) => (lastCompleted ? { text: lastCompleted } : null),
  },
];

/** External ids of the device and its features. */
export const deviceIds = (gladys) => gladys.externalIds(DEVICE_TYPE, DEVICE_ID);

/** The name shown: the one typed in the configuration, else "slskd" and the address. */
export const serverName = (server) => server.name ?? `slskd ${hostOf(server.url)}`;

/**
 * The discovery payload.
 * @param {object} gladys SDK client
 * @param {{ url: string, name: string|null }} server
 * @param {string} language feature names language
 */
export function buildDevice(gladys, server, language = 'en') {
  const ids = deviceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(server),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: server.url }],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of the device, in the `publishStates` format (null values left out).
 * @param {object} context { language, lastCompleted }
 */
export function deviceStates(gladys, snapshot, context) {
  const ids = deviceIds(gladys);
  const states = [];
  for (const { key, value } of FEATURES) {
    const result = value(snapshot, context);
    if (result === null || result === undefined) {
      continue;
    }
    const state = { device_feature_external_id: ids.feature(key) };
    if (typeof result === 'object') {
      state.text = result.text;
    } else {
      state.state = result;
    }
    states.push(state);
  }
  return states;
}

/**
 * The states of an slskd that stopped answering: "Unreachable", and nothing
 * moving (speeds and transfers in progress at 0) rather than the last values
 * frozen for hours. The list counters keep their value: unknown, not zero.
 */
export function unreachableStates(gladys, language) {
  const ids = deviceIds(gladys);
  return [
    ...[
      FEATURE_KEYS.DOWNLOAD_SPEED,
      FEATURE_KEYS.UPLOAD_SPEED,
      FEATURE_KEYS.ACTIVE,
      FEATURE_KEYS.UPLOADS,
    ].map((key) => ({ device_feature_external_id: ids.feature(key), state: 0 })),
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.STATUS),
      text: pick(STATUS_TEXT.unreachable, language),
    },
  ];
}
