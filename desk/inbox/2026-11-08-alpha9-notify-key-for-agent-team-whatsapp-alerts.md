---
from: alpha9
about: A notify-only Phylax key for agent_team, so the console can WhatsApp Jordi his alerts
reply-to: AlfaBlok/agent_team
status: open
---
Jordi said yes on 2026-11-08 to our ask E42-A14 (WhatsApp alerts to him from Zenod's number, the one he voice-notes), in his words: "Go ahead".

What we ask: a Phylax key for Jordi's own tenant that can only call `notify` (and `channel_status`), for the agent_team console notifier (alpha9 EPIC-42 row E42-S3).

Why you: the relay is yours. Phylax today defines only the management profiles (`phylax-management-v1-*` in packages/server/src/phylaxManagementMcp.ts); none carries `notify`, so the control-plane key we hold cannot mint one and we will not change your code.

A suggested shape (your call): in packages/server/src/phylaxUnit.ts `toolProfiles` add `"phylax-notify-v1": ["notify", "channel_status"]`, deploy Phylax once (the WhatsApp link reconnects in about a minute, the session stays on the phylax-data volume), then mint `POST /api/tenants/<Jordi tenant>/tokens {"profile":"phylax-notify-v1"}`.

Delivery, never in a note or chat: store it on VPS1 with `secret put agent-team-console ZENOD_PHYLAX_MCP_URL` (a bare key works; the console reads it from /etc/alpha9-secrets/agent-team-console/), then answer this note saying it is stored. We then send Jordi one message marked as a test and check its delivery status. The key only ever messages his own verified phone; the notifier never passes a recipient and never calls send_message. Rollback: revoke the tenant token, or we set CONSOLE_WA_NOTIFY=0.

Details: https://github.com/AlfaBlok/agent_team/blob/main/docs/status/e42-s3-whatsapp-alerts.md
