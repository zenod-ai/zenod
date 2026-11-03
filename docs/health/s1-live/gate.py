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

S1 it.4: Jordi sets his own password. GET/POST /password (signed in only, via a session or a one-time link)
takes a new password typed twice; the form uses autocomplete="new-password", so his Bitwarden extension offers
to save it. Only an scrypt hash is kept, in AUTH_DIR/password.scrypt (the app's bind mount, 0600). Once that
file exists the env password no longer signs in; it stays a server secret that, with the hash, keys the session
cookie, so a password change signs every other browser out. Sessions slide: a cookie older than a day is renewed
on the next request, so a browser in use stays signed in. Recovery: a one-time link from the tailnet page signs
in, then /password sets a new one. A first sign-in by link goes straight to /password while none is set.
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
AUTH_DIR = os.environ.get("HEALTH_AUTH_DIR", "/srv/auth")
RENEW_AFTER = 24 * 3600   # sliding session: re-issue a cookie once it is a day old
MIN_PW, MAX_PW = 12, 200
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1   # 16 MB per hash: fits the app's 64 MB limit

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
.note{{margin:0;font-size:14px;color:#aab2c0}}
a{{color:#8ab4f8;font-size:14px}}
</style></head><body>
{form}
</body></html>
"""

LOGIN_FORM = """<form method="post" action="/login" autocomplete="on">
<h1>Zenod health</h1>
{error}
<input type="hidden" name="next" value="{next}">
<label>Username<input name="username" type="text" autocomplete="username" autocapitalize="none" value="jordi" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" autofocus required></label>
<button type="submit">Sign in</button>
</form>"""

PW_FORM = """<form method="post" action="/password" autocomplete="on">
<h1>Set your password</h1>
{error}
<p class="note">Type a new password twice. Your password manager will offer to save it. The old password stops working.</p>
<label>Username<input name="username" type="text" autocomplete="username" value="{user}" readonly></label>
<label>New password<input name="new_password" type="password" autocomplete="new-password" minlength="{min}" maxlength="{max}" autofocus required></label>
<label>Type it again<input name="confirm_password" type="password" autocomplete="new-password" minlength="{min}" maxlength="{max}" required></label>
<button type="submit">Save password</button>
<a href="/">Back to the health page</a>
</form>"""

PW_DONE = """<form method="get" action="/">
<h1>Password saved</h1>
<p class="note">Sign in with it from now on. Other browsers were signed out; this one stays signed in.</p>
<button type="submit">Open the health page</button>
</form>"""


def session_key(secret):
    """secret = env password, plus "|" + the stored hash once Jordi has set one (no hash = the it.2 key)."""
    return hashlib.sha256(b"zenod-health-gate-v1:" + secret.encode()).digest()


def make_token(secret, now=None):
    exp = str(int((now if now is not None else time.time()) + SESSION_SECONDS))
    sig = hmac.new(session_key(secret), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def token_exp(secret, token, now=None):
    """The token's expiry if it is valid and unexpired, else 0."""
    try:
        exp, sig = token.split(".", 1)
        want = hmac.new(session_key(secret), exp.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(sig, want) and int(exp) > (now if now is not None else time.time()):
            return int(exp)
    except (ValueError, AttributeError):
        pass
    return 0


def valid_token(secret, token, now=None):
    return bool(token_exp(secret, token, now))


def hash_password(pw, salt=None):
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${dk.hex()}"


def verify_password(pw, stored):
    try:
        kind, n, r, p, salt, want = stored.split("$")
        if kind != "scrypt":
            return False
        dk = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(dk.hex(), want)
    except (ValueError, TypeError):
        return False


def read_hash(auth_dir=None):
    try:
        with open(os.path.join(auth_dir or AUTH_DIR, "password.scrypt")) as f:
            return f.read().strip()
    except OSError:
        return ""


def write_hash(stored, auth_dir=None):
    d = auth_dir or AUTH_DIR
    os.makedirs(d, mode=0o700, exist_ok=True)
    tmp = os.path.join(d, ".password.scrypt.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(stored + "\n")
    os.replace(tmp, os.path.join(d, "password.scrypt"))


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

    auth_dir = None   # tests override; None = AUTH_DIR
    _renew = False

    def _secret(self):
        stored = read_hash(self.auth_dir)
        return self.password + ("|" + stored if stored else "")

    def _check(self, user, pw):
        ok_user = hmac.compare_digest(user.encode(), self.user.encode())
        stored = read_hash(self.auth_dir)
        if stored:   # Jordi's own password replaces the env one
            ok_pass = verify_password(pw, stored)
        else:
            ok_pass = hmac.compare_digest(pw.encode(), self.password.encode())
        return ok_user and ok_pass and bool(self.password)

    def _authed(self):
        secret = self._secret()
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, val = part.strip().partition("=")
            exp = token_exp(secret, val) if name == COOKIE and self.password else 0
            if exp:
                if exp - time.time() < SESSION_SECONDS - RENEW_AFTER:
                    self._renew = True   # sliding session: end_headers sends a fresh cookie
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

    def _page(self, status, form):
        self._send(status, PAGE.format(form=form).encode(), [("Content-Type", "text/html; charset=utf-8")])

    def _login_page(self, status, error="", nxt="/"):
        err = f'<div class="err">{html.escape(error)}</div>' if error else ""
        self._page(status, LOGIN_FORM.format(error=err, next=html.escape(nxt, quote=True)))

    def _password_page(self, status, error=""):
        err = f'<div class="err">{html.escape(error)}</div>' if error else ""
        self._page(status, PW_FORM.format(error=err, user=html.escape(self.user, quote=True), min=MIN_PW, max=MAX_PW))

    def _same_origin(self):
        """CSRF guard on top of SameSite=Lax: a browser POST carries Origin; it must be this host."""
        origin = self.headers.get("Origin")
        return origin is None or urlsplit(origin).netloc == self.headers.get("Host", "")

    def _redirect(self, where, headers=()):
        self._send(HTTPStatus.SEE_OTHER, b"", [("Location", where), *headers])

    def _cookie_header(self, value, max_age):
        self._renew = False   # this answer sets the cookie itself
        flags = "Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % max_age
        if self._secure():
            flags += "; Secure"
        return ("Set-Cookie", f"{COOKIE}={value}; {flags}")

    def end_headers(self):  # every answer, static files included: never cached
        if self._renew:
            self.send_header(*self._cookie_header(make_token(self._secret()), SESSION_SECONDS))
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
                where = "/" if read_hash(self.auth_dir) else "/password"   # first link sign-in: set a password
                return self._redirect(where, [self._cookie_header(make_token(self._secret()), SESSION_SECONDS)])
            return self._login_page(HTTPStatus.UNAUTHORIZED, "This sign-in link was already used or has expired.")
        if not self._authed():
            target = parts.path + (("?" + parts.query) if parts.query else "")
            return self._login_page(HTTPStatus.UNAUTHORIZED, nxt=safe_next(target))
        if parts.path == "/password":
            return self._password_page(HTTPStatus.OK)
        return super().do_GET()

    def _set_password(self, form):
        if not self._authed():
            return self._login_page(HTTPStatus.UNAUTHORIZED, nxt="/password")
        if not self._same_origin():
            return self._send(HTTPStatus.FORBIDDEN)
        pw = form.get("new_password", [""])[0]
        if pw != form.get("confirm_password", [""])[0]:
            return self._password_page(HTTPStatus.BAD_REQUEST, "The two passwords are not the same.")
        if not MIN_PW <= len(pw) <= MAX_PW:
            return self._password_page(HTTPStatus.BAD_REQUEST, f"Use at least {MIN_PW} characters.")
        write_hash(hash_password(pw), self.auth_dir)
        self._renew = False
        body = PAGE.format(form=PW_DONE).encode()
        self._send(HTTPStatus.OK, body, [("Content-Type", "text/html; charset=utf-8"),
                                         self._cookie_header(make_token(self._secret()), SESSION_SECONDS)])

    def do_POST(self):
        if self._plain_http():
            return
        path = urlsplit(self.path).path
        if path not in ("/login", "/password"):
            return self._send(HTTPStatus.METHOD_NOT_ALLOWED)
        size = min(int(self.headers.get("Content-Length") or 0), 4096)
        form = parse_qs(self.rfile.read(size).decode("utf-8", "replace"))
        if path == "/password":
            return self._set_password(form)
        nxt = safe_next(form.get("next", ["/"])[0])
        now = time.monotonic()
        Handler.fails[:] = [t for t in Handler.fails if now - t < FAIL_WINDOW]
        if len(Handler.fails) >= MAX_FAILS:
            return self._login_page(HTTPStatus.TOO_MANY_REQUESTS, "Too many attempts. Wait a few minutes.", nxt)
        if self._check(form.get("username", [""])[0], form.get("password", [""])[0]):
            return self._redirect(nxt, [self._cookie_header(make_token(self._secret()), SESSION_SECONDS)])
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
