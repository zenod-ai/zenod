#!/usr/bin/env python3
"""EPIC-6 S1 it.2: password gate for https://health.zenod.dev (the live health inventory page).

Adapted from infra-vps scripts/health_gate.py (health.alpha9.io, EPIC-8 D3): a real HTML sign-in
form (password managers fill it; Jordi rejected the browser basic-auth popup there) and a signed
30-day session cookie. Any request without a valid session gets 401 with the sign-in form, so the
browser shows a page, never a popup. An `Authorization: Basic` header with the same credentials is
also accepted (for scripted checks).

Runs in the Dokploy app `zenod-health` (image python:3.12-alpine) on VPS1, serving the directory
that VPS3's probe timer rsyncs in every 5 min. Credentials: user HEALTH_USER (default jordi),
password env HEALTH_PAGE_PASSWORD (store: zenod-health/HEALTH_PAGE_PASSWORD). The cookie key is
derived from the password, so rotating it (env-set + redeploy) signs everybody out. Stdlib only.

S1 it.3: one-time sign-in links. GET /login/<64 hex> signs the browser in (same 30-day cookie) if
MAGIC_DIR/<sha256 of the token> exists and its content (a Unix expiry) is in the future. The file is
renamed to .used before it is checked, an atomic step, so a link works once even under concurrent
clicks and across restarts. Only hashes live on disk; the token is only in the link. Minted on VPS3 by
probe.py (signin_link), which shows the link on the tailnet copy of the page, the review card's evidence link.
"""
import base64
import hashlib
import hmac
import html
import os
import re
import sys
import time
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

COOKIE = "zenod_health_session"
SESSION_SECONDS = 30 * 24 * 3600
MAX_FAILS = 10          # failed sign-ins allowed per window (all clients together)
FAIL_WINDOW = 300
MAGIC_DIR = os.environ.get("HEALTH_MAGIC_DIR", "/srv/magic")
MAGIC_RE = re.compile(r"/login/([0-9a-f]{64})")

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Zenod health: sign in</title>
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#12151b;color:#e6e9ef;font:16px system-ui,sans-serif}}
form{{background:#1b1f27;border:1px solid #2c323d;border-radius:12px;padding:28px;width:min(340px,86vw);display:grid;gap:14px}}
h1{{margin:0 0 4px;font-size:20px}}
label{{display:grid;gap:6px;font-size:14px;color:#aab2c0}}
input{{font:inherit;padding:10px;border-radius:8px;border:1px solid #394150;background:#12151b;color:#e6e9ef}}
button{{font:inherit;padding:10px;border-radius:8px;border:0;background:#8ab4f8;color:#0b1220;font-weight:600;cursor:pointer}}
.err{{color:#ff8a80;font-size:14px}}
</style></head><body>
<form method="post" action="/login" autocomplete="on">
<h1>Zenod health</h1>
{error}
<input type="hidden" name="next" value="{next}">
<label>Username<input name="username" type="text" autocomplete="username" autocapitalize="none" value="jordi" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" autofocus required></label>
<button type="submit">Sign in</button>
</form></body></html>
"""


def session_key(password):
    return hashlib.sha256(b"zenod-health-gate-v1:" + password.encode()).digest()


def make_token(password, now=None):
    exp = str(int((now if now is not None else time.time()) + SESSION_SECONDS))
    sig = hmac.new(session_key(password), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def valid_token(password, token, now=None):
    try:
        exp, sig = token.split(".", 1)
        want = hmac.new(session_key(password), exp.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, want) and int(exp) > (now if now is not None else time.time())
    except (ValueError, AttributeError):
        return False


def redeem_magic(token, magic_dir=MAGIC_DIR, now=None):
    """True once per minted token: rename-then-check makes it single-use."""
    digest = hashlib.sha256(token.encode()).hexdigest()
    path = os.path.join(magic_dir, digest)
    try:
        os.rename(path, path + ".used")
        with open(path + ".used") as f:
            exp = int(f.read().strip())
    except (OSError, ValueError):
        return False
    return exp > (now if now is not None else time.time())


def safe_next(value):
    """Only same-site absolute paths; anything else goes to /."""
    if value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value
    return "/"


class Handler(SimpleHTTPRequestHandler):
    user = os.environ.get("HEALTH_USER", "jordi")
    password = os.environ.get("HEALTH_PAGE_PASSWORD", "")
    fails = []  # monotonic timestamps of recent failed sign-ins

    def log_message(self, fmt, *args):  # no query strings / cookies in logs
        line = re.sub(r"/login/[0-9a-f]{8,}", "/login/<link>", fmt % args)
        sys.stderr.write("%s %s\n" % (self.headers.get("X-Forwarded-For", self.address_string()) if self.headers else "-", line))

    def _check(self, user, pw):
        ok_user = hmac.compare_digest(user.encode(), self.user.encode())
        ok_pass = hmac.compare_digest(pw.encode(), self.password.encode())
        return ok_user and ok_pass and bool(self.password)

    def _authed(self):
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, val = part.strip().partition("=")
            if name == COOKIE and self.password and valid_token(self.password, val):
                return True
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                user, _, pw = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
            except ValueError:
                return False
            return self._check(user, pw)
        return False

    def _secure(self):
        return self.headers.get("X-Forwarded-Proto", "") == "https"

    def _send(self, status, body=b"", headers=()):
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _login_page(self, status, error="", nxt="/"):
        err = f'<div class="err">{html.escape(error)}</div>' if error else ""
        body = PAGE.format(error=err, next=html.escape(nxt, quote=True)).encode()
        self._send(status, body, [("Content-Type", "text/html; charset=utf-8")])

    def _redirect(self, where, headers=()):
        self._send(HTTPStatus.SEE_OTHER, b"", [("Location", where), *headers])

    def _cookie_header(self, value, max_age):
        flags = "Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % max_age
        if self._secure():
            flags += "; Secure"
        return ("Set-Cookie", f"{COOKIE}={value}; {flags}")

    def end_headers(self):  # every answer, static files included: never cached
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex")
        super().end_headers()

    def do_HEAD(self):
        self.do_GET()

    def _plain_http(self):
        """Cloudflare reaches Traefik over https always; CF-Visitor says what the browser used."""
        if '"scheme":"http"' in self.headers.get("CF-Visitor", "").replace(" ", ""):
            host = self.headers.get("Host", "health.zenod.dev")
            self._send(HTTPStatus.MOVED_PERMANENTLY, b"", [("Location", f"https://{host}{self.path}")])
            return True
        return False

    def do_GET(self):
        if self._plain_http():
            return
        parts = urlsplit(self.path)
        if parts.path == "/logout":
            return self._redirect("/login", [self._cookie_header("", 0)])
        if parts.path == "/login":
            nxt = safe_next(parse_qs(parts.query).get("next", ["/"])[0])
            if self._authed():
                return self._redirect(nxt)
            return self._login_page(HTTPStatus.OK, nxt=nxt)
        magic = MAGIC_RE.fullmatch(parts.path)
        if magic:
            if self._authed():
                return self._redirect("/")
            if self.password and redeem_magic(magic.group(1)):
                return self._redirect("/", [self._cookie_header(make_token(self.password), SESSION_SECONDS)])
            return self._login_page(HTTPStatus.UNAUTHORIZED, "This sign-in link was already used or has expired.")
        if not self._authed():
            target = parts.path + (("?" + parts.query) if parts.query else "")
            return self._login_page(HTTPStatus.UNAUTHORIZED, nxt=safe_next(target))
        return super().do_GET()

    def do_POST(self):
        if self._plain_http():
            return
        if urlsplit(self.path).path != "/login":
            return self._send(HTTPStatus.METHOD_NOT_ALLOWED)
        size = min(int(self.headers.get("Content-Length") or 0), 4096)
        form = parse_qs(self.rfile.read(size).decode("utf-8", "replace"))
        nxt = safe_next(form.get("next", ["/"])[0])
        now = time.monotonic()
        Handler.fails[:] = [t for t in Handler.fails if now - t < FAIL_WINDOW]
        if len(Handler.fails) >= MAX_FAILS:
            return self._login_page(HTTPStatus.TOO_MANY_REQUESTS, "Too many attempts. Wait a few minutes.", nxt)
        if self._check(form.get("username", [""])[0], form.get("password", [""])[0]):
            return self._redirect(nxt, [self._cookie_header(make_token(self.password), SESSION_SECONDS)])
        Handler.fails.append(now)
        time.sleep(1)
        self._login_page(HTTPStatus.UNAUTHORIZED, "Wrong username or password.", nxt)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--directory", default="/srv/www")
    a = ap.parse_args()
    if not Handler.password:
        sys.exit("HEALTH_PAGE_PASSWORD is empty; refusing to serve")
    ThreadingHTTPServer((a.bind, a.port), partial(Handler, directory=a.directory)).serve_forever()


if __name__ == "__main__":
    main()
