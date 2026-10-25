// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `downloads`.
//
// The use case, as for the pyLoad and torrent widgets of guim31: a glance at
// the wall tablet ("is the album still downloading, how long?"). So the
// widget shows the download speed, the downloads in progress and waiting,
// the time left, then a status list: the state of slskd, the files
// downloading (name, peer, percent, time left), failures, uploads, the last
// download. A "Clear completed" button when the configuration allows it.
//
// Budget (8 components, 2 texts): three tiles, one status list, one button at
// most. The figures are sent as values, not bound to device features, so the
// widget works before the device is added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MB, STATUSES } from './clients/model.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATUS_TEXT, pick } from './texts.js';
import { serverName } from './devices.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({
  CLEAR: 'clear_completed',
});
// Files downloading listed in the status rows.
export const MAX_FILE_ROWS = 4;
const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of slskd in the configuration of the integration.',
    fr: "Saisissez l'adresse de slskd dans la configuration de l'intégration.",
    de: 'Gib die Adresse von slskd in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de slskd en la configuración de la integración.',
  },
  speed: { en: 'Speed', fr: 'Vitesse', de: 'Geschwindigkeit', es: 'Velocidad' },
  downloads: {
    en: 'Downloads',
    fr: 'Téléchargements',
    de: 'Downloads',
    es: 'Descargas',
  },
  timeLeft: { en: 'Time left', fr: 'Temps restant', de: 'Restzeit', es: 'Tiempo restante' },
  waiting: { en: 'waiting', fr: 'en attente', de: 'wartend', es: 'en espera' },
  failed: {
    en: 'Failed downloads',
    fr: 'Téléchargements en échec',
    de: 'Fehlgeschlagene Downloads',
    es: 'Descargas fallidas',
  },
  uploads: {
    en: 'Uploads in progress',
    fr: 'Envois en cours',
    de: 'Laufende Uploads',
    es: 'Subidas en curso',
  },
  last: {
    en: 'Last download',
    fr: 'Dernier téléchargement',
    de: 'Letzter Download',
    es: 'Última descarga',
  },
  reading: { en: 'Reading…', fr: 'Lecture…', de: 'Lese…', es: 'Leyendo…' },
  clear: {
    en: 'Clear completed',
    fr: 'Vider les terminés',
    de: 'Fertige leeren',
    es: 'Vaciar completadas',
  },
};

// Toast after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: (count) => `${count} completed download(s) removed from the list of slskd. The files stay.`,
  fr: (count) =>
    `${count} téléchargement(s) terminé(s) retiré(s) de la liste de slskd. Les fichiers restent.`,
  de: (count) =>
    `${count} abgeschlossene(r) Download(s) aus der Liste von slskd entfernt. Die Dateien bleiben.`,
  es: (count) =>
    `${count} descarga(s) completada(s) quitada(s) de la lista de slskd. Los archivos se quedan.`,
};

// Day letter of a long time left: "2 d 4 h", "2 j 4 h"…
const DAY = { en: 'd', fr: 'j', de: 'T', es: 'd' };

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Seconds as a short duration that fits a tile (≤ 12 characters). */
export function formatDuration(seconds, language) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${Math.max(1, minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  return fit(`${Math.floor(hours / 24)} ${DAY[language] ?? DAY.en} ${hours % 24} h`, 12);
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const STATE_STYLE = {
  [STATUSES.DOWNLOADING]: { icon: 'download', color: WIDGET_COLORS.SUCCESS },
  [STATUSES.QUEUED]: { icon: 'list', color: WIDGET_COLORS.INFO },
  [STATUSES.IDLE]: { icon: 'check', color: WIDGET_COLORS.NEUTRAL },
  [STATUSES.DISCONNECTED]: { icon: 'wifi-off', color: WIDGET_COLORS.WARNING },
};

/** The status rows: the state of slskd, then its details when it answers. */
export function rows(hub, language) {
  const record = hub.record;
  const name = fit(serverName(record.server), 40);
  const status = hub.statusText(language);
  if (record.error && status === t(STATUS_TEXT.unreachable, language)) {
    return [
      {
        label: name,
        icon: 'alert-triangle',
        value: fit(t(ERROR_TEXT[record.error.kind], language), 40),
        color: WIDGET_COLORS.DANGER,
      },
    ];
  }
  const { snapshot } = record;
  if (!snapshot) {
    return [
      {
        label: name,
        icon: 'clock',
        value: t(TEXT.reading, language),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
  }
  const items = [{ label: name, value: fit(status, 40), ...STATE_STYLE[snapshot.status] }];
  for (const file of snapshot.downloads.slice(0, MAX_FILE_ROWS)) {
    items.push({
      label: fit(file.name || '?', 40),
      icon: 'arrow-down-circle',
      value: fit(
        file.etaSec
          ? `${file.percent} % · ${formatDuration(file.etaSec, language)}`
          : `${file.percent} %`,
        40,
      ),
      color: WIDGET_COLORS.INFO,
    });
  }
  if (snapshot.failed.length > 0) {
    items.push({
      label: t(TEXT.failed, language),
      icon: 'alert-circle',
      value: snapshot.failed.length,
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (snapshot.activeUploads > 0) {
    items.push({
      label: t(TEXT.uploads, language),
      icon: 'upload',
      value: snapshot.activeUploads,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const last = hub.lastCompleted();
  if (last) {
    items.push({
      label: t(TEXT.last, language),
      icon: 'check-circle',
      value: fit(last, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return items.slice(0, MAX_ROWS);
}

async function get(hub, { language = 'en' }) {
  if (!hub.record) {
    return message(TEXT.pick, language);
  }
  const { snapshot, error } = hub.record;
  const components = [];
  if (snapshot && !error) {
    const speed = snapshot.downloadSpeedBps;
    components.push(
      {
        type: 'value',
        value: Math.round((speed / MB) * 100) / 100,
        unit: 'MB/s',
        label: t(TEXT.speed, language),
        icon: 'download',
        color: speed > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        value: snapshot.activeDownloads,
        label: fit(
          snapshot.queuedDownloads
            ? `${t(TEXT.downloads, language)} (+${snapshot.queuedDownloads} ${t(TEXT.waiting, language)})`
            : t(TEXT.downloads, language),
          40,
        ),
        icon: 'list',
      },
      {
        type: 'value',
        value: snapshot.timeLeftSec > 0 ? formatDuration(snapshot.timeLeftSec, language) : '—',
        label: t(TEXT.timeLeft, language),
        icon: 'clock',
      },
    );
  }
  components.push({ type: 'status', items: rows(hub, language) });
  if (hub.config.allowClear) {
    components.push({
      type: 'button',
      label: t(TEXT.clear, language),
      icon: 'trash-2',
      style: 'secondary',
      action: { key: ACTIONS.CLEAR },
    });
  }
  const moving = snapshot && !error && snapshot.activeDownloads > 0;
  // A download moves: refresh sooner.
  return { ttl_seconds: moving ? 15 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey === ACTIONS.CLEAR) {
    const count = await hub.clearCompleted();
    return {
      message: Object.fromEntries(
        Object.entries(DONE_TEXT).map(([language, render]) => [language, render(count)]),
      ),
    };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
