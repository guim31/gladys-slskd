# slskd

Follow [slskd](https://github.com/slskd/slskd) from Gladys: the modern Soulseek client, run on a
NAS or a home server (Docker, Unraid…), with its web interface and its API. The integration reads
the local API of slskd: the speed and the downloads show on the dashboard, and Gladys can tell you
when a file is downloaded, when a download failed, when everything is finished, or when slskd
lost the Soulseek network.

The integration only reads. It never searches, downloads, shares or sends anything on the
Soulseek network: that stays your business, in slskd. Its only command, off by default, removes
the completed downloads from the list of slskd (the files stay on disk).

Tested against a real slskd 0.26.2 (two instances exchanging free test files on the Soulseek
network), not yet in a real Gladys: feedback welcome on
[GitHub](https://github.com/guim31/gladys-slskd/issues).

## Requirements

- Gladys 5.1.0 or later.
- slskd reachable from the Gladys server (same network), on its HTTP port (5030 by default) or
  its HTTPS port (5031).
- An **API key** of slskd. Add one to `slskd.yml`, then restart slskd:

  ```yaml
  web:
    authentication:
      api_keys:
        gladys:
          key: <16 to 255 characters of your choice>
          role: readonly # readwrite if you allow the clearing
          cidr: 192.168.1.0/24 # the network of Gladys
  ```

  Or with the environment variable `SLSKD_API_KEY` (the primary key of slskd). Without
  authentication in slskd (`SLSKD_NO_AUTH`, or `web.authentication.disabled: true`), leave the
  key empty.

## Configuration

- **Address**: the IP address or name, with the port: `192.168.1.10:5030`. Without port, 5030 is
  added. Write `https://` for HTTPS, and the path if slskd runs under a `url_base` or behind a
  reverse proxy (`https://example.com/slskd`).
- **API key**: the key of `slskd.yml`.
- **Name**: the name of the device in Gladys (empty: slskd followed by the address).
- **Accept self-signed certificates**: for slskd served in HTTPS with its own certificate.
- **Refresh interval**: how often slskd is read, 10 seconds to 5 minutes (30 seconds by default).
  It is also the delay of the triggers. A reading costs three calls to the local API, nothing on
  the Soulseek network.
- **Allow clearing the completed downloads**: lets a scene or the widget empty the list of
  completed downloads. Off by default.
- **Language of the feature names**: the names given to the features when you add the device,
  and the status texts.

**Test the connection** reads slskd at once and says what it finds: version, Soulseek network,
downloads.

Then, in **Discovery**, add the device.

## Devices

One device, read-only:

| Feature               | Content                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| Download speed        | KB/s, the downloads in progress                                               |
| Upload speed          | KB/s, what other Soulseek users download from you                             |
| Downloads in progress | files transferring now                                                        |
| Downloads waiting     | files requested, waiting in a queue (yours or the peer's), or between retries |
| Downloads completed   | files downloaded, in the list of slskd (until it is cleared)                  |
| Downloads failed      | files refused by the peer, in error or timed out, in the list of slskd        |
| Uploads in progress   | files other users download from you now                                       |
| Status                | Downloading, Waiting, Idle, Soulseek disconnected, or Unreachable             |
| Last download         | name of the last file completed                                               |

The device shows the badge **unreachable** when slskd does not answer.

## Widget

**slskd downloads** shows the download speed, the downloads in progress (and waiting), the time
left, then the state of slskd, the files downloading with their percent and time left, the failed
downloads, the uploads and the last download. When the clearing is allowed, a **Clear completed**
button empties the list of completed downloads.

## Scene triggers

- **Download completed**: a file finished downloading, once per file. Variables: file name,
  Soulseek user, size (MB).
- **Download failed**: a download failed (refused by the peer, error, timed out), once per file.
  Variables: file name, Soulseek user, reason. A download you cancel yourself is not a failure.
- **All downloads finished**: nothing is left to download, the last download finished or failed.
- **Soulseek network lost**: slskd is no longer connected to the Soulseek server, on two readings
  in a row (slskd reconnects by itself in a few seconds: a blip is not announced).
- **Soulseek network back**: slskd is connected again, after a loss.

After a restart of the integration, what happened meanwhile is announced; the list already there
at the first start is not.

## Scene actions

- **Read the slskd summary**: a sentence for a message ("Soulseek: connected to Soulseek, 2
  download(s) in progress, 1 waiting (850 KB/s)"), and the figures: connected (1/0), downloads in
  progress, waiting, failed.
- **Clear the completed downloads**: removes the completed downloads (succeeded, failed or
  cancelled) from the list of slskd; the files stay on disk. Refused unless **Allow clearing the
  completed downloads** is on. Output: the downloads removed from the list.

## Scene examples

- **Album downloaded**: trigger **Download completed**, action "Send a message": "Downloaded:
  {{name}} from {{user}}".
- **Evening report**: every day at 21:00, **Read the slskd summary**, then send the sentence by
  Telegram.
- **Soulseek down**: trigger **Soulseek network lost**, action "Send a message" to check the
  account or the VPN of slskd; **Soulseek network back** to say it is fine again.
- **Tidy list**: trigger **All downloads finished**, action **Clear the completed downloads**
  (with the clearing allowed).

## Troubleshooting

- **API key refused**: check the key in `slskd.yml`, and that the address of Gladys is in its
  `cidr`. slskd reads its configuration again on save; restart it if in doubt. Then save the
  configuration of the integration: a refused key is not retried on its own, so as not to fill
  the log of slskd.
- **slskd does not answer**: check the address and port (5030), and that the Gladys server
  reaches slskd (firewall, Docker network).
- **No slskd at this address**: the address answers, but not with the API of slskd. Check the
  port, or the path behind a reverse proxy.
- **The role of the API key does not allow this**: the clearing needs a `readwrite` key.
- **Soulseek disconnected**: slskd answers but is not logged in to Soulseek: account, password,
  or network of slskd (VPN). See the log of slskd.

## Limits

- One slskd per integration.
- Read-only on purpose: no search, no download, no share, no message on Soulseek.
- The counters of completed and failed downloads follow the list of slskd: they drop when you
  clear it.
- The delay of the triggers is the refresh interval. A download that starts and ends between two
  readings is still announced, as long as it is still in the list.
- A new address starts the follow-up again: what finished while you changed it is not announced.
- Not affiliated with slskd or Soulseek.
