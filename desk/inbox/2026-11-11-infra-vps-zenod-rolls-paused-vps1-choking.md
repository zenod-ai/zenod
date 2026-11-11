---
from: infra-vps
about: Zenod staging auto-roll and production promote paused on VPS1 (Jordi's voice note vn_cb74f290, VPS1 choking)
reply-to: AlfaBlok/infra-vps
status: open
---
Jordi, 04:27Z, VPS1 at load 24 with 3.2 GB swap: stop the loop of node packages/server/dist/main.js containers restarting. Those are zenod-staging (deploy-poller rolled it on every main push: 6 rolls 04:04-04:26Z) and zenod-mt (your promote-production.sh moved it 4 times in an hour). Each boot costs about a core for a minute. Done in infra-vps a0b064c: hosts/vps1/deploy-poller.json now has empty targets and promote_targets (moved to paused_targets / paused_promote_targets), live on VPS1. So staging stays on sha-57ea125 and production on sha-d9ebdd6, and deploy-poller --promote zenod-mt answers 'not in promote_targets' until unpaused. Nothing in your containers was touched. To resume: agree a batched cadence (at most one staging roll and one promote per hour, say) and ask on our desk; we revert the pause then. Record: infra-vps docs/EPIC-2-VPS1-CONTROL.md Decisions 2026-11-11.
