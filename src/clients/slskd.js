// -----------------------------------------------------------------------------
// slskd client: the REST API (`/api/v0/…`, JSON), the key in the `X-API-Key`
// header (slskd configuration: `web.authentication.api_keys`). Behaviours
// checked on a real slskd 0.26.2 (test/fixtures/slskd):
//
//   - a missing or wrong key answers 401 with an empty body; a key whose role
//     does not allow the call answers 403 (`/api/v0/server` needs the
//     administrator role: the integration reads the server state from
//     `/api/v0/application` instead, which a `readonly` key may read);
//   - `/api/v0/application`: version, and the Soulseek server state
//     (`server.isLoggedIn`, `server.state` "Connected, LoggedIn" or
//     "Disconnected"; no address while disconnected);
//   - `/api/v0/transfers/downloads` and `/uploads`: users → directories →
//     files, each with its state, size, average speed (negative between two
//     attempts), percent and remaining time (a .NET TimeSpan);
//   - `DELETE /api/v0/transfers/downloads/all/completed` (204) removes from
//     the list every completed download, succeeded, failed or cancelled; the
//     files on disk stay;
//   - an unknown route answers 404; the interface pages answer 200 in HTML.
//
// A reading costs 3 calls. Nothing else is ever sent to slskd: no search, no
// download, no message on the Soulseek network.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { ClientError, ERROR_KINDS, networkError, parseJson, safeLocation } from './errors.js';
import { toSnapshot } from './model.js';

export class SlskdClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host:port[/path]`
   * @param {string} [options.apiKey] empty when the authentication of slskd is off
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey = '', insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.base = url;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.headers = apiKey ? { 'x-api-key': apiKey } : {};
  }

  /**
   * One API call; resolves with the parsed JSON (null for an empty answer).
   * @param {'GET'|'DELETE'} method
   * @param {string} path after `/api/v0/`
   */
  async call(method, path) {
    let response;
    try {
      response = await this.request(`${this.base}/api/v0/${path}`, {
        method,
        headers: this.headers,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    if (status >= 300 && status < 400) {
      throw new ClientError(
        ERROR_KINDS.REDIRECT,
        `Redirected to ${safeLocation(response.headers?.location)}`,
        { status },
      );
    }
    if (status === 401) {
      throw new ClientError(ERROR_KINDS.AUTH, 'API key refused', { status });
    }
    if (status === 403) {
      throw new ClientError(ERROR_KINDS.PERMISSION, `${method} ${path}: forbidden`, { status });
    }
    if (status === 404) {
      throw new ClientError(ERROR_KINDS.NOT_SLSKD, `No slskd API at this address (${path})`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new ClientError(ERROR_KINDS.HTTP, `HTTP ${status} (${path})`, { status });
    }
    if (status === 204 || body === '') {
      return null;
    }
    const data = parseJson(body);
    if (data === undefined) {
      throw new ClientError(ERROR_KINDS.NOT_SLSKD, `The answer is not JSON (${path})`);
    }
    return data;
  }

  /** Everything the integration shows, as a snapshot (src/clients/model.js). */
  async read() {
    const application = await this.call('GET', 'application');
    if (!application || typeof application !== 'object' || !application.server) {
      throw new ClientError(ERROR_KINDS.NOT_SLSKD, 'No slskd application state in the answer');
    }
    const [downloads, uploads] = await Promise.all([
      this.call('GET', 'transfers/downloads'),
      this.call('GET', 'transfers/uploads'),
    ]);
    return toSnapshot({ application, downloads, uploads });
  }

  /** Remove the completed downloads from the list of slskd (not the files). */
  async clearCompletedDownloads() {
    await this.call('DELETE', 'transfers/downloads/all/completed');
  }
}
