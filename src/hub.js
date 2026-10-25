// -----------------------------------------------------------------------------
// The slskd hub: reads slskd on a timer of the container (the interval chosen
// in the configuration), publishes the states of the device to Gladys when
// they change, fires the scene events (download completed, download failed,
// nothing left to download, Soulseek network lost and back), and runs the
// commands of the widget and the scene actions.
//
// Gladys never polls the device (should_poll: false): the core does not poll
// the external devices reliably (GladysAssistant/Gladys#3198), the interval
// goes up to 5 minutes, beyond the fixed list of the core scheduler, and the
// scene events must fire even when the device was not added.
//
// States: only once the user added the device, only what changed
// (publishChangedStates of the SDK), every value again after 6 hours unchanged
// so the dashboard never shows "no recent value".
//
// Logs stay quiet: a normal reading writes at the debug level only; a failure
// that repeats on every reading writes one line when it starts and one when
// it ends. A refused API key is not retried on the timer: saving the
// configuration, "Test the connection" or a command try again.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ClientError, ERROR_KINDS } from './clients/errors.js';
import { MB } from './clients/model.js';
import { SlskdClient } from './clients/slskd.js';
import { buildDevice, deviceIds, deviceStates, serverName, unreachableState } from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  formatSpeed,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'slskd-hub' });

export const WIDGET_KEY = 'downloads';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  COMPLETED: 'download_completed',
  FAILED: 'download_failed',
  QUEUE_EMPTY: 'queue_empty',
  NETWORK_LOST: 'network_lost',
  NETWORK_RESTORED: 'network_restored',
});

export const HUB_TIMINGS = {
  // slskd failing (or off the Soulseek network) once is read again this
  // soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Readings in a row before slskd counts as unreachable, or off the network.
  downAfterFailures: 2,
  // An unchanged value is sent again after this long (the front shows "no
  // recent value" past 48 hours; the maintainer rule is 12 hours at most).
  heartbeatMs: 6 * 3600_000,
};

// The SDK refuses a scene event text over 1000 characters.
const MAX_EVENT_TEXT = 500;
const eventText = (text) => String(text ?? '').slice(0, MAX_EVENT_TEXT);
// A blip (one failed reading of a network error) is not shown as an outage:
// slskd is failing once down (two readings), or at once for an error the user
// must fix (key, address, certificate).
const TRANSIENT_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.HTTP]);
const failing = (record) =>
  record.error !== null && (record.down || !TRANSIENT_KINDS.has(record.error.kind));

const signature = (server, config) =>
  JSON.stringify([server.url, server.apiKey, config.allowSelfSigned]);

export class SlskdHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/clients/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   */
  constructor({ gladys, store, request, timers = true, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.config = null;
    /** The slskd record, null when no address is configured. */
    this.record = null;
    this.transport = null;
    this.connection = null;
    // What the triggers already announced, by base URL (see announce()).
    this.saved = { seen: null };
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = { seen: saved.seen && typeof saved.seen === 'object' ? saved.seen : null };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transport = null;
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const { server } = config;
    if (this.record && (!server || this.record.signature !== signature(server, config))) {
      this.record.dropped = true;
      clearTimeout(this.record.retryTimer);
      this.record = null;
      this.transport = null;
    }
    if (server && this.record) {
      this.record.server = server; // a new name: same connection
    } else if (server) {
      this.record = this.newRecord(server, config);
    }
    await this.publishDevices();
    await this.pollAll({ manual: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      api: new SlskdClient({
        url: server.url,
        apiKey: server.apiKey,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      snapshot: null,
      error: null,
      failures: 0,
      down: false,
      offline: 0,
      polling: null,
      retryTimer: null,
      epoch: 0,
      dropped: false,
    };
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.record?.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.record) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Device ----------------------------------------------------------------

  async publishDevices() {
    const devices = this.record
      ? [buildDevice(this.gladys, this.record.server, this.config.language)]
      : [];
    // Even an empty list: the Discovery tab then shows no stale device.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the device again, read slskd. */
  async rediscover() {
    await this.publishDevices();
    await this.pollAll({ manual: true });
  }

  /** Whether the user added the device in Gladys. */
  isCreated() {
    const id = deviceIds(this.gladys).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The user added the device: its states sent before it existed were dropped. */
  async onDeviceCreated(device) {
    if (!this.record || device.external_id !== deviceIds(this.gladys).device) {
      return;
    }
    this.transport = null;
    await this.publishStates({ force: true, created: true });
    await this.publishTransport();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading slskd ---------------------------------------------------------

  /**
   * Read slskd. `manual`: even after a refused key (a new configuration,
   * "Test the connection", "Search").
   */
  async pollAll({ manual = false } = {}) {
    const changed = this.record ? await this.poll(this.record, { manual }) : false;
    await this.afterChanges(changed);
  }

  /** Gladys asks for a refresh (onPoll): read slskd now. */
  async pollDevice() {
    await this.pollAll();
  }

  /**
   * Read slskd and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record, { manual = false } = {}) {
    if (!manual && record.error?.kind === ERROR_KINDS.AUTH) {
      return Promise.resolve(false); // waits for the user (see the header)
    }
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    // A command sent while this reading was in flight makes its answer stale:
    // drop it, the command reads slskd again once done.
    const epoch = record.epoch;
    let snapshot;
    try {
      snapshot = await record.api.read();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
    if (record.epoch !== epoch) {
      return false;
    }
    return this.applySuccess(record, snapshot);
  }

  label(record) {
    return `slskd (${serverName(record.server)})`;
  }

  async applySuccess(record, snapshot) {
    if (record.dropped) {
      return false;
    }
    const previous = record.snapshot;
    if (record.down) {
      logger.info(`${this.label(record)} answers again`);
    } else if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (previous === null) {
      logger.info(
        `${this.label(record)}: connected${snapshot.version ? ` (version ${snapshot.version})` : ''}`,
      );
    }
    record.failures = 0;
    record.down = false;
    record.error = null;
    clearTimeout(record.retryTimer);
    record.offline = snapshot.connected ? 0 : record.offline + 1;
    if (record.offline === 1) {
      this.scheduleRetry(record); // confirm soon whether the network is lost
    }
    const widgetChanged =
      previous === null ||
      previous.status !== snapshot.status ||
      previous.pendingCount !== snapshot.pendingCount ||
      previous.failed.length !== snapshot.failed.length ||
      previous.succeeded.length !== snapshot.succeeded.length ||
      previous.activeUploads !== snapshot.activeUploads;
    record.snapshot = snapshot;
    await this.announce(record, snapshot);
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    if (!TRANSIENT_KINDS.has(err.kind)) {
      record.failures = 0;
      if (!record.down) {
        record.down = true; // the states would otherwise freeze on the last reading
        await this.publishStates();
      }
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.publishStates();
      return true;
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * Fire "download completed" once per download that succeeded, "download
   * failed" once per download that failed, "queue empty" when nothing is left
   * to download, "network lost" once slskd is off the Soulseek network on two
   * readings in a row, "network restored" when it is back. The first reading
   * only remembers the state; after a restart of the integration, what
   * changed meanwhile is announced.
   *
   * Transfers are keyed by their id (a GUID): downloading the same file again
   * makes a new transfer, announced again.
   */
  async announce(record, snapshot) {
    const key = record.server.url;
    const entry = this.saved.seen;
    // Off the network is confirmed on the second reading (a reconnection of
    // slskd takes a few seconds); back on the network at once.
    const network = snapshot.connected
      ? true
      : record.offline >= this.timings.downAfterFailures
        ? false
        : (entry?.network ?? null);
    const state = {
      key,
      succeeded: snapshot.succeeded.map((file) => file.id),
      failed: snapshot.failed.map((file) => file.id),
      pending: snapshot.pendingCount > 0,
      network,
    };
    if (
      !entry ||
      entry.key !== key ||
      !Array.isArray(entry.succeeded) ||
      !Array.isArray(entry.failed)
    ) {
      this.saved.seen = { ...state, last: snapshot.succeeded[0]?.name ?? null };
      this.store.save(this.saved);
      return;
    }
    const knownSucceeded = new Set(entry.succeeded);
    const knownFailed = new Set(entry.failed);
    // Oldest first, so "last download" ends on the newest one.
    const completed = snapshot.succeeded.filter((file) => !knownSucceeded.has(file.id)).reverse();
    const failed = snapshot.failed.filter((file) => !knownFailed.has(file.id));
    const emptied = entry.pending === true && !state.pending;
    const lost = entry.network === true && network === false;
    const restored = entry.network === false && network === true;
    const changed =
      completed.length > 0 ||
      failed.length > 0 ||
      entry.pending !== state.pending ||
      entry.network !== state.network ||
      entry.succeeded.length !== state.succeeded.length ||
      entry.failed.length !== state.failed.length;
    if (!changed) {
      return;
    }
    const last = completed.length ? completed[completed.length - 1].name : entry.last;
    this.saved.seen = { ...state, last: last ?? null };
    this.store.save(this.saved);
    if (lost) {
      logger.info(`${this.label(record)}: Soulseek network lost`);
      await this.fire(TRIGGERS.NETWORK_LOST, record, {});
    }
    if (restored) {
      logger.info(`${this.label(record)}: Soulseek network back`);
      await this.fire(TRIGGERS.NETWORK_RESTORED, record, {});
    }
    for (const file of completed) {
      logger.debug(`${this.label(record)}: completed "${file.name}"`);
      await this.fire(TRIGGERS.COMPLETED, record, {
        name: eventText(file.name),
        user: eventText(file.user),
        size_mb: Math.round((file.bytes / MB) * 10) / 10,
      });
    }
    for (const file of failed) {
      logger.debug(`${this.label(record)}: failed "${file.name}"`);
      await this.fire(TRIGGERS.FAILED, record, {
        name: eventText(file.name),
        user: eventText(file.user),
        reason: eventText(file.reason),
      });
    }
    if (emptied) {
      logger.debug(`${this.label(record)}: nothing left to download`);
      await this.fire(TRIGGERS.QUEUE_EMPTY, record, {});
    }
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  /** The name of the last file completed, null when none. */
  lastCompleted() {
    const entry = this.saved.seen;
    return entry && this.record && entry.key === this.record.server.url
      ? (entry.last ?? null)
      : null;
  }

  /** The states of the device, if the user added it. */
  async publishStates({ force = false, created = false } = {}) {
    const record = this.record;
    if (!record || (!created && !this.isCreated())) {
      return;
    }
    const language = this.config.language;
    let states;
    if (record.snapshot && !record.down) {
      states = deviceStates(this.gladys, record.snapshot, {
        language,
        lastCompleted: this.lastCompleted(),
      });
    } else if (record.down) {
      states = [unreachableState(this.gladys, language)];
    } else {
      return;
    }
    try {
      if (force) {
        this.gladys.forgetPublishedStates(deviceIds(this.gladys).device);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransport();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: "local", or "unreachable". */
  async publishTransport() {
    const record = this.record;
    if (!record || !this.isCreated() || (record.snapshot === null && record.error === null)) {
      return;
    }
    if (record.error !== null && !failing(record)) {
      return;
    }
    const transport = failing(record) ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    if (this.transport === transport) {
      return;
    }
    const externalId = deviceIds(this.gladys).device;
    try {
      await this.gladys.publishTransports([{ external_id: externalId, transport }]);
      this.transport = transport;
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const { server, invalidUrl } = this.config;
    if (!server) {
      return {
        connected: false,
        message: invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    if (!failing(this.record)) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = pick(ERROR_TEXT[this.record.error.kind], language).slice(0, 200);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------

  /** The record a command targets; throws when slskd is not configured. */
  target() {
    if (!this.record) {
      throw new Error(pick(ACTION_TEXT.noServer, this.config?.language));
    }
    return this.record;
  }

  /**
   * Remove the completed downloads (succeeded, failed, cancelled) from the
   * list of slskd. The files stay on disk. Only when the configuration
   * allows it.
   * @returns {Promise<number>} the downloads removed from the list
   */
  async clearCompleted() {
    const record = this.target();
    const language = this.config.language;
    const refuse = (kind) => {
      throw new Error(pick(ERROR_TEXT[kind], language));
    };
    if (!this.config.allowClear) {
      refuse(ERROR_KINDS.CLEAR_OFF);
    }
    // Read first: the count says what the user sees go.
    await this.poll(record, { manual: true });
    const before = record.snapshot
      ? record.snapshot.succeeded.length + record.snapshot.failed.length
      : 0;
    try {
      record.epoch += 1;
      try {
        await record.api.clearCompletedDownloads();
      } finally {
        record.epoch += 1;
      }
    } catch (err) {
      if (!(err instanceof ClientError)) {
        throw err;
      }
      logger.warn(`${this.label(record)}: clearing failed: ${err.message}`);
      if (err.kind !== ERROR_KINDS.PERMISSION) {
        await this.applyFailure(record, err);
      }
      await this.afterChanges(true);
      refuse(err.kind);
    }
    logger.info(`${this.label(record)}: completed downloads cleared from the list`);
    await record.polling;
    await this.poll(record, { manual: true });
    await this.afterChanges(true);
    return before;
  }

  // --- Reports ---------------------------------------------------------------

  /** One line on slskd, in every language: the report and the summary. */
  describe() {
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!this.record) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const record = this.record;
      const name = serverName(record.server);
      if (record.error) {
        message[language] = labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        continue;
      }
      const { snapshot } = record;
      if (!snapshot) {
        message[language] = labelled(name, pick(ERROR_TEXT.unreachable, language), language);
        continue;
      }
      const parts = [text.network(snapshot.connected)];
      if (snapshot.pendingCount > 0) {
        let downloads = text.downloads(snapshot.activeDownloads, snapshot.queuedDownloads);
        if (snapshot.downloadSpeedBps > 0) {
          downloads += ` (${formatSpeed(snapshot.downloadSpeedBps, language)})`;
        }
        parts.push(downloads);
      } else {
        parts.push(text.nothing);
      }
      if (snapshot.failed.length) {
        parts.push(text.failed(snapshot.failed.length));
      }
      if (snapshot.activeUploads) {
        parts.push(text.uploads(snapshot.activeUploads));
      }
      message[language] = labelled(name, parts.join(', '), language);
    }
    return message;
  }

  /** "Test the connection": read slskd now, then describe it. */
  async testConnection() {
    await this.pollAll({ manual: true });
    const message = this.describe();
    if (this.record && !this.record.error && this.record.snapshot) {
      for (const [language, text] of Object.entries(REPORT_TEXT)) {
        const version = this.record.snapshot.version;
        message[language] =
          `${text.ok}, slskd${version ? ` ${version}` : ''}. ${message[language]}`;
      }
    } else if (this.config.invalidUrl) {
      for (const language of Object.keys(message)) {
        message[language] = pick(CONNECTION_TEXT.invalidUrl, language);
      }
    }
    return message;
  }

  /** Status text of the current state, for the widget and the summary. */
  statusText(language) {
    const record = this.record;
    if (!record) {
      return null;
    }
    if (record.error && failing(record)) {
      return pick(STATUS_TEXT.unreachable, language);
    }
    return record.snapshot ? pick(STATUS_TEXT[record.snapshot.status], language) : null;
  }
}
