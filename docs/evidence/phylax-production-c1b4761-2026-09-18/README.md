# Phylax-only production reliability promotion

Date: 2026-09-18 Europe/Paris

Approval: `APPROVE PHYLAX-ONLY PRODUCTION UPGRADE to sha-c1b4761`

## Scope

Upgrade only the private integrated Phylax service used by Zenod Hosted. Public
Zenod, PM, standalone Phylax, billing, signup and Telegram were not changed.

## Target

| Item | Value |
|---|---|
| Dokploy application | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) |
| Swarm service | `app-index-back-end-panel-6zm3qg` |
| Volume | `phylax-data:/data` |
| Previous source/image | `d02493c` / `ghcr.io/zenod-ai/phylax@sha256:97173b3362bbc0b77c3dd1ee2fb18ceeb11c42d70ad8e13335789748e703ae92` |
| Deployed source/image | `c1b4761` / `ghcr.io/zenod-ai/phylax@sha256:75e8fdc9977fc33754d91375c82b8d75fb4d2a08733e7b9be3ab4740a50ef6f0` |
| Image revision / runtime | `c1b47617f5e31902a40b72c759abde04fcb0fc70` / `phylax-only` |
| Rollback image | `ghcr.io/zenod-ai/phylax@sha256:97173b3362bbc0b77c3dd1ee2fb18ceeb11c42d70ad8e13335789748e703ae92` |

## Preservation checks

- Dokploy environment before and after: byte-for-byte identical, 37 pairs.
- Runtime environment canonical SHA-256 remained
  `43e9520e682d0d4f0d1d02c3f0985f502a7cd9dbbe76e27e35b25bc0811f9ec5`.
- `phylax-data:/data` remained mounted and writable.
- Instance identity remained
  `phylax-for-zenod / zenod / zenod / zenod-primary`.
- The persisted WhatsApp session was reused. The container reconnected without
  QR, operator action or a new pairing.
- `/data/phylax-instance.json` remained present; the WhatsApp state contained
  3,960 files.
- Public Zenod remained on
  `ghcr.io/zenod-ai/zenod@sha256:63c1f2ce8dae2ee22afb297f571cab038282ac9f9538f9b8ae817f0c1a6150e9`
  and health SHA `1f9a3ea0a3f38b0c56506581a48adb1ef4d21bab`.

## Live verification

After deployment, `https://phylax.zenod.dev/api/health` reported:

- `status: ok`
- `sha: c1b47617f5e31902a40b72c759abde04fcb0fc70`
- instance `phylax-for-zenod`, mode `zenod`, downstream adapter `zenod`,
  commercial owner `zenod`, service number `zenod-primary`
- worker `ok`
- WhatsApp `connected` and receive path `ready`
- `operatorActionRequired: false`
- `restart.required: false`, outage `0`

The Swarm service reported one replica, completed update state, and the exact
target image. The running container image ID was
`sha256:86de212cb752724270b5c4395663ef69d5a92bcbd5f069491c4c000692629469`.
No QR, logged-out, fatal or auth-failure event was present in the post-upgrade
log window.

## Product delta

The direct Phylax runtime delta from `d02493c` to `c1b4761` is the 45-second
foreground chat deadline in `packages/server/src/phylaxChannels.ts`, introduced
by `d8aba00`. This avoids sending a premature "still working" acknowledgement
before a normal WhatsApp chat answer arrives. The image also contains the
corrected Phylax bundle boundary from `f6e48ca`.

The Phylax management MCP contract is unchanged between the previous and
deployed revisions, so the existing Zenod BFF remains compatible.

## Real-phone acceptance

On 2026-09-18 at 15:57–16:01 Europe/Paris, Jordi exercised the live WhatsApp
path from a real phone. The observed sequence proved:

- a normal text message received a normal reply (`hey bro` → `Hey bro 👋 What's up?`);
- a voice note was received and queued for transcription;
- transcription completed;
- the Google Drive audio artifact link was returned;
- the captured transcript was returned (`Do you understand what I'm saying? Can you say the word banana?`);
- Phylax delivered the terminal capture receipt back to WhatsApp.

This is a PASS for the Zenod Hosted + integrated WhatsApp text, voice capture,
transcription, Drive archive and receipt path on the deployed revision.

Residual UX observation: the live transcript also showed three intermediate
messages during the filing window (“still filing”, “still working” and “retry
shortly”) before the final capture receipt. That is not a transport failure, but
it is the next bounded reliability-polish candidate if it remains noticeable.
