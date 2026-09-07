# Zenod V5 landing-page production rollout

Date: 2026-09-07  
Scope: public Zenod only  
Status: PASS

## Candidate

- Reviewed PR: [#1228](https://github.com/zenod-ai/zenod/pull/1228)
- Merged source: `006587b8d9ee53338625e5b1d9f71c9c9b6fdee2`
- CI: [run 34079642884](https://github.com/zenod-ai/zenod/actions/runs/34079642884), PASS
- Publication: [run 34080011522](https://github.com/zenod-ai/zenod/actions/runs/34080011522), PASS
- OCI index: `ghcr.io/zenod-ai/zenod@sha256:1c34f17a93e370e1379ec19251f3b3b423a2dda5ba22c596fb687da75df589cb`
- Linux/amd64 manifest: `sha256:bc67a438e44c54d43fad9fc5c5f0406994cf892899cca2a090f12286d3eef3e9`
- OCI revision and baked `GIT_SHA`: exact merged source above.

## Change

The public landing page now carries the approved V5 direction: “Your agents. One memory. Totally yours.” The Librarian of Alexandria is integrated into the hero; the content-map prototype controls were not shipped. Sign-in, fail-closed Hosted checkout, the €9/month + VAT offer, self-host route and legal links remain functional.

The rotating “Your memory, yours to …” line uses Geist at approximately 17 px, a fixed 13.5-character word window and centered grid alignment. Browser geometry measured a 0 px center delta between the sentence and animated word. The hero asset was converted from a 2.7 MB PNG to a 284 KB WebP.

## Validation

Before merge:

- `npm run test -w site`: 12/12 PASS
- `npm run lint -w site`: PASS
- `npm run typecheck -w site`: PASS
- `npm run build -w site`: PASS
- desktop browser: hero image loaded; no horizontal overflow; rotating-line alignment and Geist font verified
- 390 × 844 browser: hero width and document width both 390 px; two-column proof strip; no horizontal overflow

After deploy:

- Swarm update: completed at 2026-09-07 03:41:25 UTC
- Running task: `xa80l38of9ey`
- Public health: `status=ok`, exact source SHA
- Public HTML title: `Zenod — your agents, one memory, totally yours`
- Hero WebP: loaded at 1672 × 941
- Live rotating-line center delta: approximately 0 px; Geist Variable, 16.8 px at the desktop viewport
- Live 390 px layout: document, hero and viewport widths match; no horizontal overflow
- Production readiness: HTTP 503, `ready=false`, `publicPaidSignup=false` as required
- Non-`GIT_SHA` environment: unchanged
- Mounts: unchanged
- Private Phylax: not deployed or restarted
- Data migration/restoration: none

The existing secure recovery receipt and rollback target remain under the operator-only state directory documented in the deployment spine. No secret values are recorded here.
