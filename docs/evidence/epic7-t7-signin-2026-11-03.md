# EPIC-7 T7 / E7-A15: one-click sign-in browser for Jordi (2026-11-03)

Run `run_afbb67a6-ea57-4fae-8493-8688cc85d18a`. Bound epic: [EPIC-7](../EPIC-7-REAL-USER-TEST.md), ask E7-A15. Previous try: [T7 2026-11-02](epic7-t7-2026-11-02.md). Jordi could not find the T3 browser panel and asked for a link. No secrets are in this page.

## Result

One URL now opens a real Chromium on VPS3 in Jordi's normal Mac browser over Tailscale, already on Google's sign-in page with operations@alpha9.io filled in ([screenshot through noVNC](epic7-t7/04-novnc-google-signin.png)). The URL (with its one-time token and password) is in `~t3agent/.agent-browser/signin/url.txt` on VPS3 (mode 0600 in a 0700 dir) and went to the Delivery Manager in the run report only. A watcher notices the sign-in, stops the VNC stack and proves the session works headless from the same profile.

## What runs (VPS3, user t3agent)

| Piece | Detail |
|---|---|
| Xvfb | display `:77`, 1440x900, `-nolisten tcp` |
| Chromium | Playwright `chromium-1248` (Chrome for Testing 156), headed, maximised, profile `~/.agent-browser/operations-profile` (0700), sandbox on; CDP on 127.0.0.1:9333 only |
| x11vnc | `-localhost` port 5977, one-time random VNC password (`-rfbauth`, file 0600) |
| noVNC | websockify bound to the tailnet IP only, `100.86.141.63:6081`; files served under a random 32-char path; the web root shows a blank page (no directory listing) |
| Watcher | `~/.agent-browser/signin/watch.mjs` (node 22): every 20 s reads cookies over CDP; on a Google `SID` cookie it waits 90 s, stops the stack, opens the profile headless and checks `myaccount.google.com` loads without a redirect to sign-in; writes one word to `result.txt` and `watch.log`. Gives up after 7 days. |

Checks at 01:05Z: noVNC page `200` on `vps3.taild81fbb.ts.net:6081/<token>/vnc.html`; same port on the public IP: no answer (not bound); a headless browser opened the full URL, noVNC said "Connected", and the Google sign-in page rendered (screenshot above).

## Root changes on VPS3 (root disk; a VPS3 recreate wipes them)

- apt: `xvfb x11vnc novnc python3-websockify` and Chromium's missing libs `libcups2t64 libcairo2 libpango-1.0-0 fonts-liberation fonts-noto-color-emoji`.
- AppArmor profile `/etc/apparmor.d/agent-browser-chromium` (same shape as T3's `t3-chrome-headless-shell`): lets only the Playwright `chrome` binary under `~t3agent` use user namespaces for its own sandbox. Revert as root: `apparmor_parser -R /etc/apparmor.d/agent-browser-chromium && rm /etc/apparmor.d/agent-browser-chromium`.
- Root came through the documented VPS1 route (infra-vps `docs/vps3-faq.md`).

## Stop / restart

- Stop everything, keep the profile: `~/.agent-browser/signin/signin-browser.sh stop` and `kill $(cat ~/.agent-browser/signin/watch.pid)`.
- Status: `~/.agent-browser/signin/signin-browser.sh status`; result: `cat ~/.agent-browser/signin/result.txt`.
- New link (fresh token and password): `signin-browser.sh stop; signin-browser.sh start`, then read `url.txt`.

## For agents afterwards

Reuse the signed-in profile headless: `--user-data-dir=/home/t3agent/.agent-browser/operations-profile` with the same `chromium-1248` binary (only one Chromium may hold the profile at a time). Risk not yet tested: Google may refuse sign-in in Chrome for Testing ("browser may not be secure"); if Jordi sees that, the next step is system Chrome stable in the same stack.

## Status at hand-off

Stack and watcher running, waiting for Jordi's sign-in; run set to `monitoring`.
