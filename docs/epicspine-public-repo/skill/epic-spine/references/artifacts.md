# Artifacts As URLs

Serve every HTML or visual artifact from a local static server and report a clickable URL, never a file path or `file://` link. A file path is not viewable by the user; a URL is.

## Serve

Run in the background, one server per task, bound to loopback only:

```sh
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory <artifact-dir> &
```

Record `url`, `port`, `pid`, and `directory`. Reuse a running server for the same directory instead of starting another.

Serve only the artifact directory, never the repository root — serving the root exposes `.git` and the working tree. The port probe races with the bind: if the server exits with `Address already in use`, re-run the probe and retry.

## Verify before reporting

```sh
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/<file>
```

Report only after it returns `200`. Then report the clickable link `http://127.0.0.1:<port>/<file>`.

- Workers return `url`, `port`, `pid`, and `directory` in the handoff; the manager relays the same link to the user.
- The manager stops the server when the user is done or on a sweep; see `hygiene.md`.
- A repository may override this (for example a declared dev-server URL); use the override and report it.
