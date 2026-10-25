// -----------------------------------------------------------------------------
// The snapshot the slskd client produces (src/clients/slskd.js), so the rest
// of the integration never deals with the API format:
//
//   version            slskd version, e.g. "0.26.2.0" (null when unknown)
//   connected          logged in to the Soulseek server
//   status             'downloading' | 'queued' | 'idle' | 'disconnected'
//   downloadSpeedBps   sum of the downloads in progress, bytes per second
//   uploadSpeedBps     sum of the uploads in progress
//   activeDownloads    downloads initializing or transferring
//   queuedDownloads    downloads requested or waiting in a queue (local or
//                      remote, retries included)
//   pendingCount       active + queued downloads
//   activeUploads      uploads initializing or transferring
//   timeLeftSec        time left of the longest download in progress, 0 when none
//   downloads          downloads in progress: { id, name, user, percent, etaSec }
//   succeeded          downloads completed: { id, name, user, bytes, endedAt }
//   failed             downloads that failed: { id, name, user, reason }
//   cancelled          downloads the user cancelled, still in the list
//
// The transfer lists are the ones slskd keeps until they are cleared (its
// interface, or the "clear" scene action): the counters of completed and
// failed downloads follow them.
//
// Transfer states (Soulseek.NET TransferStates, a flags enum written
// "Completed, Succeeded"): None, Requested, Queued, Initializing, InProgress,
// Completed, Succeeded, Cancelled, TimedOut, Errored, Rejected, Aborted,
// Locally, Remotely. Checked on slskd 0.26.2 (test/fixtures/slskd): a file
// the peer does not share ends "Completed, Rejected"; a peer gone offline
// puts the download back to "Queued, Locally" with an exception between its
// attempts, then "Completed, Errored" after the third one.
// -----------------------------------------------------------------------------

export const KB = 1024;
export const MB = 1024 * 1024;

export const STATUSES = Object.freeze({
  DOWNLOADING: 'downloading',
  QUEUED: 'queued',
  IDLE: 'idle',
  DISCONNECTED: 'disconnected',
});

// Completed without the file: failures. "Cancelled" is the user's own doing,
// not a failure.
const FAILED_FLAGS = ['Errored', 'TimedOut', 'Rejected', 'Aborted'];
const ACTIVE_FLAGS = ['InProgress', 'Initializing'];

/** The flags of a transfer state ("Completed, Succeeded" → Set). */
export const stateFlags = (state) =>
  new Set(
    String(state ?? '')
      .split(',')
      .map((flag) => flag.trim())
      .filter(Boolean),
  );

/** Kind of a transfer: 'succeeded' | 'failed' | 'cancelled' | 'active' | 'queued'. */
export function transferKind(state) {
  const flags = stateFlags(state);
  if (flags.has('Completed')) {
    if (flags.has('Succeeded')) {
      return 'succeeded';
    }
    return FAILED_FLAGS.some((flag) => flags.has(flag)) ? 'failed' : 'cancelled';
  }
  if (ACTIVE_FLAGS.some((flag) => flags.has(flag))) {
    return 'active';
  }
  // Requested, Queued (locally or remotely), None, or a state unknown yet:
  // still to download.
  return 'queued';
}

/** A number from a JSON field; null when not one. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/**
 * A .NET TimeSpan ("00:00:20.4660512", "1.02:03:04") in whole seconds; 0 when
 * negative (slskd writes "-00:00:00.0049923" between two attempts) or unknown.
 */
export function timeSpanSeconds(value) {
  const match = /^(-)?(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(String(value ?? ''));
  if (!match || match[1]) {
    return 0;
  }
  const [, , days = '0', hours, minutes, seconds] = match;
  return Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** File name of a Soulseek path ("Music\\Artist\\01 - Song.flac" → "01 - Song.flac"). */
export function baseName(path) {
  const text = typeof path === 'string' ? path : '';
  const name = text.split(/[\\/]/).filter(Boolean).pop();
  return name ?? '';
}

const count = (value) => Math.max(0, Math.round(toNumber(value) ?? 0));
const speed = (value) => Math.max(0, toNumber(value) ?? 0);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const firstLine = (value) => text(value).split('\n')[0].trim();

/**
 * The files of a transfers answer: users → directories → files. Removed
 * transfers are left out (slskd hides them already, unless asked).
 */
export function flattenTransfers(users) {
  const files = [];
  for (const user of Array.isArray(users) ? users : []) {
    for (const directory of Array.isArray(user?.directories) ? user.directories : []) {
      for (const file of Array.isArray(directory?.files) ? directory.files : []) {
        if (file && typeof file === 'object' && file.removed !== true && text(file.id)) {
          files.push({ ...file, username: text(file.username) || text(user.username) });
        }
      }
    }
  }
  return files;
}

/**
 * The snapshot of a reading.
 * @param {object} parts the answers of slskd
 * @param {object} parts.application `GET /api/v0/application`
 * @param {unknown[]} parts.downloads `GET /api/v0/transfers/downloads`
 * @param {unknown[]} parts.uploads `GET /api/v0/transfers/uploads`
 */
export function toSnapshot({ application, downloads, uploads }) {
  const server = application?.server ?? {};
  const connected = server.isLoggedIn === true;
  const files = { downloads: [], succeeded: [], failed: [] };
  let activeDownloads = 0;
  let queuedDownloads = 0;
  let cancelled = 0;
  let downloadSpeedBps = 0;
  for (const file of flattenTransfers(downloads)) {
    const kind = transferKind(file.state);
    const name = baseName(file.filename) || text(file.id);
    const user = text(file.username);
    if (kind === 'active') {
      activeDownloads += 1;
      downloadSpeedBps += speed(file.averageSpeed);
      files.downloads.push({
        id: file.id,
        name,
        user,
        percent: Math.min(100, Math.floor(toNumber(file.percentComplete) ?? 0)),
        etaSec: timeSpanSeconds(file.remainingTime),
      });
    } else if (kind === 'queued') {
      queuedDownloads += 1;
    } else if (kind === 'cancelled') {
      cancelled += 1;
    } else if (kind === 'succeeded') {
      files.succeeded.push({
        id: file.id,
        name,
        user,
        bytes: count(file.size),
        endedAt: text(file.endedAt),
      });
    } else if (kind === 'failed') {
      files.failed.push({
        id: file.id,
        name,
        user,
        reason: firstLine(file.exception) || [...stateFlags(file.state)].pop() || '',
      });
    }
  }
  let activeUploads = 0;
  let uploadSpeedBps = 0;
  for (const file of flattenTransfers(uploads)) {
    if (transferKind(file.state) === 'active') {
      activeUploads += 1;
      uploadSpeedBps += speed(file.averageSpeed);
    }
  }
  // Newest first, by end of transfer (ISO dates sort as text).
  files.succeeded.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  let status;
  if (!connected) {
    status = STATUSES.DISCONNECTED;
  } else if (activeDownloads > 0) {
    status = STATUSES.DOWNLOADING;
  } else if (queuedDownloads > 0) {
    status = STATUSES.QUEUED;
  } else {
    status = STATUSES.IDLE;
  }
  const version = text(application?.version?.current) || null;
  return {
    version,
    connected,
    status,
    downloadSpeedBps,
    uploadSpeedBps,
    activeDownloads,
    queuedDownloads,
    pendingCount: activeDownloads + queuedDownloads,
    activeUploads,
    timeLeftSec: files.downloads.reduce((max, file) => Math.max(max, file.etaSec), 0),
    downloads: files.downloads.sort((a, b) => b.percent - a.percent),
    succeeded: files.succeeded,
    failed: files.failed,
    cancelled,
  };
}
