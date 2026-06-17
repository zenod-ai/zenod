# C1 Deployment Discipline

`c1.zenod.dev` is the canonical Console deployment. Use it for Console health
checks, channel debugging, and live smoke tests:

```sh
curl -fsS https://c1.zenod.dev/api/health
```

`app.zenod.dev` is retired for this stack and must not be used as proof that C1
or the channels are healthy. A healthy C1 rollout should leave:

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://app.zenod.dev/api/health
```

returning a non-Console response such as `404`.

## Deploy Rule

Do not patch source files directly under Dokploy's generated checkout on the
VPS. Code changes land by:

1. Commit to a branch.
2. Open a PR.
3. Merge to `main`.
4. Let Dokploy rebuild from `main`.

If the VPS checkout is dirty, treat that as deployment drift. Remove the drift
by returning code files to `origin/main`; keep only Dokploy-generated compose
labels local to Dokploy.

## Voice Smoke

After a main deploy touching channel code:

1. Send WhatsApp text.
2. Send WhatsApp voice.
3. Send Telegram text.
4. Send Telegram voice.

Expected voice behavior is boring: platform audio becomes bytes, bytes become a
transcript, and the transcript enters the same engine path as typed text. There
must be no voice-note `Digest job`, `Got this voice note`, or queue-only reply.
