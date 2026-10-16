# Artifacts As URLs

Serve every HTML or visual artifact from a local static server and report a clickable URL, never a file path or `file://` link. A file path is not viewable by the user; a URL is.

## Serve

Run `python3 scripts/artifact_host.py` (path from the skill dir): it prints `{"host", "bind"}`. Nothing needs configuring: a headless machine (not macOS/Windows, and no `DISPLAY`, `WAYLAND_DISPLAY` or x11/wayland `XDG_SESSION_TYPE`) with a working Tailscale gets the MagicDNS name and the tailnet IP (so a Mac or phone can open it); a desktop, or a headless machine without Tailscale, gets `127.0.0.1` for both, silently. Env `EPICSPINE_ARTIFACT_HOST` only overrides: `local` (or `127.0.0.1`) forces loopback, `tailscale` forces the tailnet (warns on stderr and falls back to loopback if it fails), any other value is a hostname and its IPv4. `EPICSPINE_ARTIFACT_BIND` overrides the bind. The bind is never `0.0.0.0` or a public address: only loopback, tailnet, or private ranges, else it falls back to `127.0.0.1`.

Run in the background, one server per task:

```sh
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
python3 -m http.server "$PORT" --bind <bind> --directory <artifact-dir> &
```

Record `url`, `port`, `pid`, and `directory`. Reuse a running server for the same directory instead of starting another.

Serve only the artifact directory, never the repository root — serving the root exposes `.git` and the working tree. The port probe races with the bind: if the server exits with `Address already in use`, re-run the probe and retry.

## Verify before reporting

```sh
curl -s -o /dev/null -w '%{http_code}' http://<host>:<port>/<file>
```

Report only after the reported URL returns `200`. Then report the clickable link `http://<host>:<port>/<file>` on its own line.

- Workers return `url`, `port`, `pid`, and `directory` in the handoff; the manager relays the same link to the user.
- The manager stops the server when the user is done or on a sweep; see `hygiene.md`.
- A repository may override this (for example a declared dev-server URL); use the override and report it.
- Optional HTTPS upgrade (needs root or `tailscale set --operator`): `tailscale serve --bg --https=443 http://127.0.0.1:<port>`.

## Enforcement

`scripts/url_gate.py` is a Claude Code `Stop` hook (installed by `agents_block.py install-global`, skipped by `--no-hooks`). It blocks a final reply that names an `.html`/`.htm`/`.svg`/`.png`/`.pdf` path or `file://` without a reachable URL, and blocks any such URL that does not return HTTP 200. Host resolved to loopback: a `127.0.0.1`/`localhost` URL (a repo's declared serve script or dev-server URL is fine). Host resolved to the tailnet or another host (auto-detected or overridden): a URL on that host or its bind IP; `127.0.0.1`/`localhost` links are useless to a remote reader and count as missing. It blocks at most twice per turn, then allows, and fails open on any error. Disable with `EPICSPINE_URL_GATE=off`.

## Machine setup

Nothing needed: headless + Tailscale is detected automatically on every machine, and a desktop keeps `127.0.0.1`. The env var is only an override (`local`, `tailscale`, or a hostname). To pin it for Claude Code seats: `agents_block.py install-global --artifact-host local|tailscale|HOST` (repeat `--config-dir DIR` per seat; `--artifact-host ""` removes it); it writes `env` in each `settings.json`, picked up by new sessions. Other harnesses: a quoted systemd drop-in, e.g. `~/.config/systemd/user/t3code.service.d/artifact.conf` with `Environment="EPICSPINE_ARTIFACT_HOST=local"`, then restart the service.
