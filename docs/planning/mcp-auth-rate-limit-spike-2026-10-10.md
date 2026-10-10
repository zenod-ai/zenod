# Spike: rate limiting failed /mcp auth attempts (cloud.zenod.dev)

Date 2026-10-10 · Status: spike, nothing deployed, no production changes · Related: PR #1373 (`feat/cloud-static-mcp-tokens`, open, not on main)

## TL;DR

- Production is **one replica** behind **Traefik only** (Cloudflare is DNS-only), so #1373's in-memory limiter is adequate today. The only real gap is that it resets on restart/deploy.
- Right-most X-Forwarded-For is correct **today** (Traefik overwrites XFF with the peer IP). It silently breaks if Cloudflare proxying is re-enabled: every client would share a CF edge IP. Prefer `CF-Connecting-IP` in that case, or add a startup/config guard.
- Do **not** rely on the proxy: Traefik `rateLimit` counts all requests (not failures) and cannot express "10 failed auths". Keep the limiter in the app.
- Recommended: merge #1373 as is, then (optionally) swap its store to the SQLite limiter prototyped here (`packages/server/src/authFailureLimiter.ts`, env flag `MCP_AUTH_RATE_LIMIT_STORE=sqlite`, default off). Add an alert-only global counter and a token-hash key. Redis is not in the stack and is not worth adding.
- Separately, `/oauth/register`, `/oauth/token` and `/api/auth/login` (self-host) have **no** abuse protection. `/oauth/register` is the most worthwhile follow-up (unauthenticated writes to SQLite).

## 1. Replicas and what sits in front

| Finding | Evidence |
|---|---|
| 1 replica | `docs/evidence/zenod-alpha-readiness-2026-08-16/README.md:29,43` ("1/1 replica"); `docs/EPIC-ZENOD-MEMORY-RELIABILITY.md:111` ("one-replica service, `zenod-mt-data:/data`"); `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/index.html:257` |
| Traefik is the edge | same evidence page line 282 ("Traefik sends both zenod.dev and cloud.zenod.dev to it"); `docker-compose.z2.yml:9` (Dokploy wires Traefik + TLS) |
| Cloudflare is not proxying | `docs/EPIC-2-HOSTED-READINESS.md:405-414`: record set to **DNS-only**, "origin 49.13.24.121, Let's Encrypt cert direct, no Cloudflare WAF in the path". Probe today: `dig +short cloud.zenod.dev` returned `49.13.24.121` (a single origin IP, not a CF range); `curl -sI https://cloud.zenod.dev/api/health` and `/mcp` returned no `cf-ray`, `server`, or `via` headers (HTTP/2 200 and 401 respectively). |

XFF reasoning. With Traefik as the first hop and no `forwardedHeaders.trustedIPs`, Traefik discards any client-supplied XFF and sets it to the TCP peer, so XFF has exactly one entry and right-most == the real client. Spoofed leading entries are ignored by `.pop()`. That matches the comment at `zenodUnit.ts:200-206` on the #1373 branch.

Failure modes:
1. **Cloudflare re-enabled (orange cloud)**: Traefik would see a CF edge IP as peer; XFF's right-most becomes the CF IP (CF's own `X-Forwarded-For` content is overwritten unless `trustedIPs` lists CF ranges). Every client collapses onto a few CF IPs, so ten bad attempts anywhere can lock out everyone on that edge. Fix then: add CF ranges to Traefik `trustedIPs` and key on `CF-Connecting-IP` only when the peer is a CF range.
2. **Docker Swarm ingress mode** (the evidence mentions "Docker service metadata" and replicas, i.e. Swarm): if Traefik's ports are published through the Swarm ingress mesh rather than host mode, the peer IP can be SNAT'd to an internal address and all clients would look identical. Dokploy normally runs Traefik with host-published ports, which preserves it.

Confidence: **high** on replicas/Cloudflare (repo evidence from Aug/Sep plus a live DNS/header check today), **medium** on XFF correctness. Not verifiable from the repo: Traefik's static config on the VPS, whether Traefik publishes in host mode, the live Cloudflare dashboard state. The cheap safe check is a log line (or temporary debug endpoint behind admin auth) showing XFF and socket peer for one known request from a known IP.

## 2. Proxy/CDN instead of the app?

| Option | Pros | Cons |
|---|---|---|
| Cloudflare WAF rate limiting | Absorbs volumetric abuse before the origin | Requires re-proxying the host. That was deliberately turned off because WAF returned 1010 for Stripe webhooks (`EPIC-2-HOSTED-READINESS.md:405`). Per-plan rule counts/periods are limited and counting only *failed* (401) responses is a higher-tier feature (from memory, **unverified**; needs dashboard access). |
| Traefik `ratelimit` middleware | Cheap, no code | Counts every request, not failures. A legit MCP client legitimately bursts, so a threshold low enough to stop guessing would throttle real use; a high one does not stop guessing. Per-instance, in-memory. Config lives in Dokploy, not in this repo. |
| App-level (recommended) | Knows what a *failure* is; per-account/token awareness; versioned and tested in the repo | Costs a DB/memory lookup per request; still needs correct client IP |

A reasonable layering later: a coarse Traefik/CF per-IP request cap (for example 600/min) as a DoS floor, with the app limiter handling auth-failure logic.

## 3. If the app owns it: storage, keys, limits

- **Redis**: none. `grep -ri redis` over `packages/server/src`, compose files and the Dockerfile finds nothing. Do not add one.
- **SQLite already everywhere**: `node:sqlite` `DatabaseSync` with `PRAGMA journal_mode = WAL` (for example `packages/server/src/hostedChannels.ts:159-163`, `phylaxChannels.ts:506-508`), all under the single `/data` volume (`zenod-mt-data`). A new `auth-rate-limit.sqlite` file in the same data dir fits, survives restarts, and is shared by multiple processes on that volume if replicas ever exceed one (WAL + `busy_timeout`). Multi-host replicas without a shared volume would need a different store; not a current need.
- **Prototype**: `packages/server/src/authFailureLimiter.ts` (about 120 lines) plus `test/authFailureLimiter.test.ts`. Sliding-window log table `(key, at)` indexed on `(key, at)`; rows are only inserted while a key is under its cap, so storage is bounded; expired rows swept at most once per minute. Method names (`isBlocked`, `retryAfterSeconds`, `recordFailure`) match #1373's `FailedAttemptLimiter`; `check(keys)` evaluates several keys at once. Flag `MCP_AUTH_RATE_LIMIT_STORE=sqlite`, default off (factory returns `null`). Not wired to any route.
- **Keys**: `ip:<addr>`, `tok:<first 12 hex of sha256(token)>`, `global`. Token text is never stored or logged.
- **Honest limit on the token key**: static tokens are high-entropy and guessers send a new value each time, so `tok:` rarely trips against guessing. Its value is stopping one stale/revoked token being replayed by a misconfigured client across IPs. The IP and global keys do the real work.

Proposed limits (all counted on failures only, 5-minute sliding window):

| Key | Max failures | Response when exceeded |
|---|---|---|
| per IP | 10 | 429 + `Retry-After` (= #1373 default) |
| per token hash | 5 | 429 + `Retry-After` |
| global (alert-only) | 300 | **Never blocks.** `check()` returns `globalTripped`; caller warn-logs once. |

Avoiding lockout abuse of legit users:
- Count only requests that **present a well-formed `zmt_` token and fail**. Requests with no credentials (the 401 discovery probe every MCP client makes first) must not count.
- Never log or return which key tripped; log only the fingerprint and IP.
- IP spoofing is not possible while Traefik is the sole hop; a victim can only be locked out if they share a NAT with the attacker. That is acceptable for per-IP 10/5min; keep the number generous and do not escalate to long bans.
- Do not exempt valid tokens from a blocked IP: that turns the limiter into a guessing oracle. Accept the NAT trade-off instead.
- The global key must never block: a few dozen attacker IPs could trip it and lock out every real user. It only raises an alert (`globalTripped`); per-IP and per-token keys do all blocking.

## 4. OAuth and dashboard login

Inventory on main (`packages/server/src/app.ts`, `zenodUnit.ts`):

| Route | Where | Current abuse protection |
|---|---|---|
| `POST /oauth/register` | `app.ts:355`, `oauth.ts:73-98`; forwarded by `zenodUnit.ts:1284` | None. Unauthenticated, writes a client row per call, `redirect_uris` unvalidated beyond being an array. **Highest follow-up priority** (storage growth). Use an IP limiter on *all* requests, not only failures. |
| `GET /oauth/authorize`, `POST /oauth/authorize/decision` | `app.ts:356-357` | Needs a valid session / admin to approve; no throttle. Codes expire in 10 min (`oauth.ts:8`). |
| `POST /oauth/token` | `app.ts:358`, `oauth.ts:~200-255` | None. Code/refresh values are random; PKCE and timing-safe compare (`oauth.ts:68`) but no failure throttle. Same limiter, scope `oauth_token`. |
| `POST /api/auth/login` (self-host admin password) | `app.ts:388-395` | None; returns 401 "wrong password" indefinitely. Plain brute-forceable. In hosted mode the customer layer 404s it (`customerLayer.ts:785`), so only self-host is exposed. |
| `POST /api/token/regenerate`, `/api/account/*` | `customerLayer.ts:1367` etc. | Require a signed customer session cookie; no throttle but not a guessing surface. |
| GitHub/Google OAuth callbacks | `customerLayer.ts:711-712` | Delegated to providers. |

Recommendation: yes, reuse the same limiter with distinct scopes (`oauth_register` counts every request; `oauth_token` and `admin_login` count failures). Keep it a follow-up PR after #1373.

## Rollout plan

1. Merge #1373 as is (in-memory, fine for 1 replica).
2. Add a one-time log of XFF vs socket peer to confirm the real-client-IP assumption in prod (read-only observation; needs a human to look at logs).
3. Follow-up PR: wire `SqliteFailureLimiter` behind `MCP_AUTH_RATE_LIMIT_STORE` (default off), dark-launch with the env var set in staging, then prod. Add the `tok:` key and the alert-only `global` counter (warn-log once on trip, never reject).
4. Follow-up PR: `/oauth/register`, `/oauth/token`, `/api/auth/login`.
5. If Cloudflare proxying is ever re-enabled, change client-IP derivation first (see section 1).

## Open questions needing a human

1. Cloudflare dashboard: confirm `cloud.zenod.dev` is still grey-cloud, and the plan tier/rule limits if a CF rule is ever wanted.
2. Dokploy/VPS: Traefik static config (`forwardedHeaders.trustedIPs`) and whether ports are host-published, i.e. does the app see real client IPs.
3. Are there known clients that legitimately sit behind large shared NATs (offices, mobile carriers) that would trip 10 failures/5 min?
4. Approve extending protection to OAuth register/token and admin login, and the 300/5-min alert threshold for the global counter (no traffic baseline in the repo).
