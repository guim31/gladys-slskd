// -----------------------------------------------------------------------------
// The errors of the slskd client, sorted by what the user can do about them.
// Messages are English, for the logs, and never contain a secret: the texts
// shown in Gladys come from src/texts.js, by kind.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address or port, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key missing or refused (401)
  PERMISSION: 'permission', // the key may not do this (403: its role)
  NOT_SLSKD: 'not_slskd', // something answers, not the API of slskd
  REDIRECT: 'redirect', // the address redirects (usually to HTTPS)
  HTTP: 'http', // any other answer the integration cannot use
  TOO_LARGE: 'too_large', // a transfer list over 16 MB: it needs clearing in slskd
  CLEAR_OFF: 'clear_off', // clearing the list is not allowed in the configuration
});

export class ClientError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ClientError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A network failure of node:http(s), as a ClientError. */
export function networkError(err) {
  if (err.code === 'ERESPONSETOOLARGE') {
    return new ClientError(ERROR_KINDS.TOO_LARGE, 'Transfer list over 16 MB');
  }
  if (TLS_CODES.has(err.code)) {
    return new ClientError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new ClientError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

/** A redirect target fit for the logs: no user, password or query string. */
export function safeLocation(location) {
  if (typeof location !== 'string' || location === '') {
    return '?';
  }
  try {
    const url = new URL(location, 'http://relative.invalid');
    return url.host === 'relative.invalid' ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return '?';
  }
}

export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
