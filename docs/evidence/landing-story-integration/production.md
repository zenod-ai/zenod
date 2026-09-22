# Approved landing production receipt — 2026-09-22

Status: deployed and verified at 2026-09-22T03:06:23.220711+00:00.

- Public page: https://zenod.dev/
- Exact user-approved and deployed source: `c1d835774aaccbc3accc764738e47871c23ad107`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:72adae06e1eefaaf99320a45dee87d16f0ff6db9ad46fb0f558cab00834cc291`.
- Running task: `z34v123v98gn`; actual container/OCI revision and health checked by the candidate-bound helper.
- Implementation PR: https://github.com/zenod-ai/zenod/pull/1364 (merged as `60239a3a51c1577302c7483ed390314b28e76c41`). Production intentionally pins the approved branch SHA, not the later merge SHA.
- CI: https://github.com/zenod-ai/zenod/actions/runs/35681249836 — pass.
- Image publication: https://github.com/zenod-ai/zenod/actions/runs/35681249989 — pass.
- Site tests: 17/17 pass; build passes. Diff from prior live `99f9f228285053d1354474b089691d86fe090fef` contains only site and documentation changes.

## Recovery and scope

Fresh quiesced archive passed isolated restore verification: 7,199 files, 807 JSON files, 589 SQLite files. Independent Mac copy checksum verified. Protected candidate-bound snapshots, manifest, deploy intent and verification receipt: `/Users/jordi/.local/state/zenod-landing-c1d8357-20260922/`. Rollback derives the prior image from that manifest and requires a fresh queue inspection. No data restore or migration performed.

Only public Zenod was deployed. Non-SHA environment and mounts are unchanged; all other Swarm service image references match the baseline. Four unrelated legacy auto-deploy triggers were confirmed disabled. Phylax was not deployed. Existing publication workflow builds both images, but that is not deployment authority for Phylax.

## Public verification

The public browser renders all ten new chapter headings and the unchanged hero. Chapter 02 shows matching Hellenic librarians on capture and MCP sides. Capture artwork loads; 640px and 390px viewport checks show no horizontal overflow. Screenshots: [public section](public-journey.png), [mobile section](public-mobile-journey.png).

Production readiness HTTP 200 currently reports `ready=true`, `publicPaidSignup=true`, `publicGoogleSignup=true`, `evidenceReady=false`, with advisory checks for Stripe webhook, billing portal, live billing journey and exact-SHA Drive acceptance. This deployment did not alter signup settings, credentials or acceptance records. No real sign-in, payment, channel send or billing validation was performed. Older local-preview notes about signup being closed are not authoritative for the current production configuration.
