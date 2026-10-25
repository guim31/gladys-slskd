# slskd for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[slskd](https://github.com/slskd/slskd), the modern client of the Soulseek file sharing network.
It reads the local API of slskd, shows the downloads on the dashboard, and starts scenes when a
file is downloaded, a download failed, everything is finished, or slskd loses the Soulseek
network.

Tested against a real slskd 0.26.2, not yet in a real Gladys: feedback welcome in the
[issues](https://github.com/guim31/gladys-slskd/issues).

## Features

- **One device**, read-only: download and upload speed, downloads in progress, waiting, completed
  and failed, uploads in progress, status (including "Soulseek disconnected"), last download.
  Feature names in French by default, or English, German, Spanish.
- **Scene triggers**: _Download completed_ (file name, Soulseek user, size), _Download failed_
  (with the reason given by slskd), _All downloads finished_, _Soulseek network lost_ and
  _Soulseek network back_. Once each, including what happened while the integration was
  restarting.
- **Scene actions**: _Read the slskd summary_ (a sentence for a message, and the figures), and
  _Clear the completed downloads_ (off until allowed in the configuration; the files stay).
- **Widget** _slskd downloads_: speed, downloads, time left, the files in progress with their
  percent and time left, failures, uploads, last download, and a _Clear completed_ button when
  allowed.
- **Test the connection** button in the configuration.

The features, triggers, widget and actions follow the sibling integrations
[gladys-pyload](https://github.com/guim31/gladys-pyload) and
[gladys-arr](https://github.com/guim31/gladys-arr), so the download tools behave the same way in
Gladys. Read-only on purpose: the integration never searches, downloads or shares anything on
Soulseek.

## Requirements

- Gladys 5.1.0 or later.
- slskd on the local network of Gladys, with an **API key** (`web.authentication.api_keys` in
  `slskd.yml`, or `SLSKD_API_KEY`); the `readonly` role is enough, `readwrite` to clear the list.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this
   repository: `https://github.com/guim31/gladys-slskd` (or install **slskd** from the catalog
   once it is listed).
2. In **Configuration**, enter the address with its port (`192.168.1.10:5030`), the API key, and
   optionally a name. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the device.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- The integration reads slskd on its own timer (30 s by default, 10 s to 5 min), not through the
  polling of Gladys (the device is published with `should_poll: false`,
  GladysAssistant/Gladys#3198). Only the changed values are sent to Gladys, and each value again
  after 6 hours.
- A reading is `GET /api/v0/application` (version, Soulseek server state),
  `/api/v0/transfers/downloads` and `/api/v0/transfers/uploads`, with the `X-API-Key` header.
  The one command is `DELETE /api/v0/transfers/downloads/all/completed`.
- A refused key is not retried on the timer: saving the configuration or **Test the connection**
  tries again.
- What the triggers already announced (transfer ids, whether something was left to download,
  whether slskd was on the network) is kept in `/data/slskd-state.json`, so a restart neither
  repeats nor misses an event.

## Checked on real software, and what was not

The session that wrote this integration ran two slskd 0.26.2 instances in Docker, logged in to the
real Soulseek network with made-up accounts. One shared two free test files made for the occasion,
the other downloaded them (and a file that does not exist, refused by the peer); a throttled link
gave a real download in progress, a stopped peer a real "Completed, Errored" after three
attempts, and a blocked server a real "Disconnected" state. The answers are recorded, anonymised,
in `test/fixtures/slskd` and replayed by the tests; the integration itself ran in the sandbox of
Gladys (read-only root, no capability, 256 MB) against these instances.

Not checked: a real Gladys (dashboard rendering, scene editor, Discovery tab), HTTPS with a
self-signed certificate, a reverse proxy.

## Limitations

- One slskd per integration.
- The counters of completed and failed downloads follow the list slskd keeps: they drop when it is
  cleared.
- The delay of the triggers is the refresh interval.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [slskd](https://github.com/slskd/slskd) by JP Dillingham and contributors (AGPL-3.0); its API
  is read, no code is copied. The logo of the cover comes from the slskd repository.
- Structure adapted from [gladys-pyload](https://github.com/guim31/gladys-pyload) and the
  official [integration template](https://github.com/GladysAssistant/integration-template-js).

Not affiliated with slskd or Soulseek.

## License

[Apache-2.0](LICENSE)
