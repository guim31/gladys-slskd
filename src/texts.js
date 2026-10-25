// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the state of slskd, the "Test the connection"
// report, the summary of the scene action, scene action errors. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table. Brand names (slskd,
// Soulseek) are never translated.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './clients/errors.js';
import { STATUSES } from './clients/model.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of slskd in the configuration.',
    fr: "Saisissez l'adresse de slskd dans la configuration.",
    de: 'Gib die Adresse von slskd in der Konfiguration ein.',
    es: 'Introduzca la dirección de slskd en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:5030',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:5030',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:5030',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:5030',
  },
};

// One short explanation per error kind (src/clients/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'slskd does not answer',
    fr: 'slskd ne répond pas',
    de: 'slskd antwortet nicht',
    es: 'slskd no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused: check it in slskd.yml (web.authentication.api_keys)',
    fr: "clé d'API refusée : vérifiez-la dans slskd.yml (web.authentication.api_keys)",
    de: 'API-Schlüssel abgelehnt: Prüfe ihn in slskd.yml (web.authentication.api_keys)',
    es: 'clave de API rechazada: compruébela en slskd.yml (web.authentication.api_keys)',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'the role of the API key does not allow this: use readwrite',
    fr: "le rôle de la clé d'API ne le permet pas : utilisez readwrite",
    de: 'die Rolle des API-Schlüssels erlaubt das nicht: Nutze readwrite',
    es: 'el rol de la clave de API no lo permite: use readwrite',
  },
  [ERROR_KINDS.NOT_SLSKD]: {
    en: 'no slskd at this address: check the port (5030)',
    fr: 'pas de slskd à cette adresse : vérifiez le port (5030)',
    de: 'kein slskd unter dieser Adresse: Prüfe den Port (5030)',
    es: 'no hay slskd en esta dirección: compruebe el puerto (5030)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  [ERROR_KINDS.TOO_LARGE]: {
    en: 'transfer list too long: clear the completed downloads in slskd',
    fr: 'liste des transferts trop longue : videz les téléchargements terminés dans slskd',
    de: 'Transferliste zu lang: Leere die fertigen Downloads in slskd',
    es: 'lista de transferencias demasiado larga: vacíe las descargas completadas en slskd',
  },
  [ERROR_KINDS.CLEAR_OFF]: {
    en: 'clearing is off: allow it in the configuration of the integration',
    fr: "le nettoyage est désactivé : autorisez-le dans la configuration de l'intégration",
    de: 'Aufräumen ist aus: Erlaube es in der Konfiguration der Integration',
    es: 'la limpieza está desactivada: permítala en la configuración de la integración',
  },
};

// The "Status" feature, and the state row of the widget.
export const STATUS_TEXT = {
  [STATUSES.DOWNLOADING]: {
    en: 'Downloading',
    fr: 'Téléchargement',
    de: 'Lädt herunter',
    es: 'Descargando',
  },
  [STATUSES.QUEUED]: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  [STATUSES.IDLE]: { en: 'Idle', fr: 'Inactif', de: 'Leerlauf', es: 'Inactivo' },
  [STATUSES.DISCONNECTED]: {
    en: 'Soulseek disconnected',
    fr: 'Soulseek déconnecté',
    de: 'Soulseek getrennt',
    es: 'Soulseek desconectado',
  },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
};

// The "Test the connection" report and the summary of the scene action.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    network: (connected) => (connected ? 'connected to Soulseek' : 'not connected to Soulseek'),
    downloads: (active, queued) => `${active} download(s) in progress, ${queued} waiting`,
    failed: (count) => `${count} failed`,
    uploads: (count) => `${count} upload(s)`,
    nothing: 'no download in progress',
  },
  fr: {
    ok: 'OK',
    network: (connected) => (connected ? 'connecté à Soulseek' : 'pas connecté à Soulseek'),
    downloads: (active, queued) => `${active} téléchargement(s) en cours, ${queued} en attente`,
    failed: (count) => `${count} en échec`,
    uploads: (count) => `${count} envoi(s)`,
    nothing: 'aucun téléchargement en cours',
  },
  de: {
    ok: 'OK',
    network: (connected) => (connected ? 'mit Soulseek verbunden' : 'nicht mit Soulseek verbunden'),
    downloads: (active, queued) => `${active} Download(s) laufen, ${queued} warten`,
    failed: (count) => `${count} fehlgeschlagen`,
    uploads: (count) => `${count} Upload(s)`,
    nothing: 'kein laufender Download',
  },
  es: {
    ok: 'OK',
    network: (connected) => (connected ? 'conectado a Soulseek' : 'no conectado a Soulseek'),
    downloads: (active, queued) => `${active} descarga(s) en curso, ${queued} en espera`,
    failed: (count) => `${count} fallida(s)`,
    uploads: (count) => `${count} subida(s)`,
    nothing: 'ninguna descarga en curso',
  },
};

// Errors of the scene actions and the widget button.
export const ACTION_TEXT = {
  noServer: {
    en: 'No slskd is configured.',
    fr: "Aucun slskd n'est configuré.",
    de: 'Kein slskd ist konfiguriert.',
    es: 'No hay ningún slskd configurado.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A decimal number written the way the language writes it ("2,5" in French). */
export const decimal = (value, language, digits = 1) =>
  value.toLocaleString(language === 'en' ? 'en-US' : language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/** A speed for people: "850 KB/s", "2,4 MB/s". */
export const formatSpeed = (bytesPerSecond, language) =>
  bytesPerSecond >= 1024 * 1024
    ? `${decimal(bytesPerSecond / (1024 * 1024), language)} MB/s`
    : `${Math.round(bytesPerSecond / 1024)} KB/s`;
