// -----------------------------------------------------------------------------
// An in-memory slskd behind the `request` seam of the client
// (src/clients/http.js). Its answers start from the real responses recorded
// in test/fixtures/slskd (slskd 0.26.2), with the behaviours that matter: the
// API key (401 without it, 403 for a forbidden call), the Soulseek server
// state, the transfer lists grouped by user and directory, the removal of the
// completed downloads, a server that does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (path) =>
  readFileSync(new URL(`../fixtures/slskd/${path}`, import.meta.url), 'utf8');
export const fixtureJson = (path) => JSON.parse(fixture(path));

// Made-up key (slskd accepts any string of 16 to 255 characters).
export const API_KEY = 'gladys-test-key-0123456789abcdef';

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', server: 'Kestrel' },
  body: body === undefined ? '' : JSON.stringify(body),
});

function offline() {
  const error = new Error('connect ECONNREFUSED');
  error.code = 'ECONNREFUSED';
  return error;
}

/** The files of a recorded transfers answer. */
const filesOf = (path) =>
  fixtureJson(path).flatMap((user) => user.directories.flatMap((directory) => directory.files));

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export class FakeSlskd {
  /**
   * @param {object} [options]
   * @param {string|null} [options.apiKey] null: authentication off
   * @param {Array} [options.downloads] transfer files (flat)
   */
  constructor({ apiKey = API_KEY, downloads = filesOf('0.26.2/downloads-completed.json') } = {}) {
    this.apiKey = apiKey;
    this.online = true;
    this.application = fixtureJson('0.26.2/application.json');
    this.downloads = structuredClone(downloads);
    this.uploads = [];
    this.calls = [];
    this.forbidden = new Set();
  }

  /** Log in to the Soulseek server, or lose it (the recorded "Disconnected" state). */
  setConnected(connected) {
    this.application.server = connected
      ? fixtureJson('0.26.2/application.json').server
      : fixtureJson('0.26.2/application-disconnected.json').server;
  }

  /** A download in a given state; returns its id. */
  addDownload({
    name = 'Track.flac',
    user = 'gladys-test-b',
    state = 'InProgress',
    size = 30 * 1024 * 1024,
    percent = 40,
    speed = 512 * 1024,
    remaining = '00:01:30.5000000',
    exception,
    endedAt,
  } = {}) {
    const id = newId();
    this.downloads.push({
      id,
      username: user,
      direction: 'Download',
      filename: `Music\\Artist\\${name}`,
      size,
      state,
      bytesTransferred: Math.round((size * percent) / 100),
      averageSpeed: speed,
      attempts: 1,
      removed: false,
      percentComplete: percent,
      remainingTime: remaining,
      ...(exception ? { exception } : {}),
      ...(endedAt ? { endedAt } : {}),
    });
    return id;
  }

  find(id) {
    return this.downloads.find((file) => file.id === id);
  }

  complete(id, endedAt = '2026-10-25T16:30:00.0000000Z') {
    Object.assign(this.find(id), {
      state: 'Completed, Succeeded',
      percentComplete: 100,
      averageSpeed: 600000,
      remainingTime: '00:00:00',
      endedAt,
    });
  }

  fail(id, exception = 'Transfer rejected: File not shared.', state = 'Completed, Rejected') {
    Object.assign(this.find(id), {
      state,
      exception,
      averageSpeed: 0,
      endedAt: '2026-10-25T16:31:00Z',
    });
  }

  addUpload({ state = 'InProgress', speed = 100 * 1024 } = {}) {
    this.uploads.push({
      id: newId(),
      username: 'gladys-test-c',
      direction: 'Upload',
      filename: 'share\\gladys-test-free-file.txt',
      size: 46,
      state,
      averageSpeed: speed,
      removed: false,
    });
  }

  /** Group flat files as slskd does: users → directories → files. */
  static group(files) {
    const users = new Map();
    for (const file of files) {
      const directory = file.filename.split('\\').slice(0, -1).join('\\');
      const user = users.get(file.username) ?? new Map();
      users.set(file.username, user);
      const list = user.get(directory) ?? [];
      user.set(directory, list);
      list.push(file);
    }
    return [...users].map(([username, directories]) => ({
      username,
      directories: [...directories].map(([directory, files]) => ({
        directory,
        fileCount: files.length,
        files,
      })),
    }));
  }

  async handle(url, { method = 'GET', headers = {} } = {}) {
    const path = new URL(url).pathname.replace(/^\/api\/v0\//, '');
    this.calls.push(`${method} ${path}`);
    if (!this.online) {
      throw offline();
    }
    if (this.apiKey && headers['x-api-key'] !== this.apiKey) {
      return json(401);
    }
    if (this.forbidden.has(path)) {
      return json(403);
    }
    if (method === 'GET' && path === 'application') {
      return json(200, this.application);
    }
    if (method === 'GET' && path === 'transfers/downloads') {
      return json(200, FakeSlskd.group(this.downloads.filter((file) => !file.removed)));
    }
    if (method === 'GET' && path === 'transfers/uploads') {
      return json(200, FakeSlskd.group(this.uploads));
    }
    if (method === 'DELETE' && path === 'transfers/downloads/all/completed') {
      this.downloads = this.downloads.filter((file) => !file.state.startsWith('Completed'));
      return json(204);
    }
    return json(404);
  }
}

/** A network of fake slskd instances, by origin, behind one `request` function. */
export function createNetwork(servers = {}) {
  const byOrigin = new Map(Object.entries(servers));
  return {
    servers: byOrigin,
    async request(url, options) {
      const server = byOrigin.get(new URL(url).origin);
      if (!server) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return server.handle(url, options);
    },
  };
}
