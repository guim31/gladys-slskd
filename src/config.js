// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One slskd instance: its address, its API key (empty when the authentication
// of slskd is off), a name. The device identity does not depend on the
// address: an IP changed for a host name, or HTTP for HTTPS, keeps the device
// and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Port slskd listens on out of the box (HTTP), added to a bare host.
export const DEFAULT_PORT = 5030;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  name: '',
  allow_self_signed: false,
  poll_interval: '30',
  allow_clear: false,
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `nas.local:5030`), or the URL copied from the browser
 * (`http://192.0.2.10:5030/downloads`). HTTP by default; a bare host without
 * port gets port 5030. A path is kept (slskd may run under a `url_base`, or
 * behind a reverse proxy), without a trailing page of the interface, `/api`
 * or slash.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(
      /\/(api(\/v0)?|searches|downloads|uploads|browse|users|chat|rooms|system|contacts|login|wishlist)$/i,
      '',
    )
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('url');
  const url = typed ? parseServerUrl(typed) : null;
  const flag = (key) => source[key] === true || source[key] === 'true';
  return {
    server: url
      ? {
          url,
          apiKey: text('api_key'),
          name: text('name').slice(0, MAX_NAME_LENGTH) || null,
        }
      : null,
    invalidUrl: Boolean(typed) && !url,
    allowSelfSigned: flag('allow_self_signed'),
    allowClear: flag('allow_clear'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
