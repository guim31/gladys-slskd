// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Read the slskd summary" gives a sentence for a message (Telegram, the
// speaker…) and the figures as outputs. "Clear completed downloads" empties
// the list of slskd (the files stay on disk), only when the configuration
// allows it. Nothing that searches, downloads or shares: the Soulseek network
// stays the user's business, in slskd.
// -----------------------------------------------------------------------------

import { pick } from './texts.js';

export const SCENE_ACTIONS = {
  async read_summary(hub) {
    // Read now: the sentence says what is true at the time of the scene.
    await hub.pollAll({ manual: true });
    const snapshot = hub.record && !hub.record.error ? hub.record.snapshot : null;
    return {
      summary: pick(hub.describe(), hub.config.language),
      connected: snapshot?.connected ? 1 : 0,
      downloading: snapshot?.activeDownloads ?? 0,
      waiting: snapshot?.queuedDownloads ?? 0,
      failed: snapshot?.failed.length ?? 0,
    };
  },

  async clear_completed(hub) {
    const cleared = await hub.clearCompleted();
    return { cleared };
  },
};
