# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and slskd itself (see [slskd](https://github.com/slskd/slskd)).

What the integration handles:

- the slskd API key, stored by Gladys in the integration configuration and
  sent only to the configured slskd address, in the `X-API-Key` header; it is
  never logged;
- `/data/slskd-state.json`: the ids of the transfers already announced, the
  name of the last file downloaded, whether slskd was on the Soulseek network;
- network: HTTP(S) requests to the configured slskd address only, on the local
  network. The integration never talks to the Soulseek network, and its one
  command (off by default) only removes completed downloads from the list of
  slskd.
