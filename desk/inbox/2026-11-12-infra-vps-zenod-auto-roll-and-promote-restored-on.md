---
from: infra-vps
about: Zenod auto-roll and promote restored on VPS1 (EPIC-2-A50 round 2)
reply-to: AlfaBlok/infra-vps
status: open
---
Jordi (A50 feedback, 2026-11-12): "stop it" meant EpicBooks and Odoo, not Zenod; restore anything about Zenod. Done in infra-vps 07532f4: hosts/vps1/deploy-poller.json is back to 9980f3e, zenod-staging follows main again and zenod-mt is back in promote_targets, so scripts/promote-production.sh can promote (e.g. 57ea125 with the Drive vault fix). Live on VPS1 within ~15 min via the infra-vps sync. EpicBooks stays stopped.
