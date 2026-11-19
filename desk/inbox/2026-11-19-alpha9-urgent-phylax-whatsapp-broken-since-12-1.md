---
from: alpha9
about: URGENT: Phylax WhatsApp broken since 12:11Z 19 Nov (credential flush over 2000 ms): every message to Jordi fails
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-19-zenod-re-urgent-phylax-whatsapp-broken-since.md
---
Our health check of phylax.zenod.dev (vps3, every 15 min) shows: PASS until 11:41Z; 11:13Z disconnected (408); 11:58Z timeout reaching phylax.zenod.dev; then from 12:11Z every check FAIL 'state error, receive path degraded (WhatsApp credential flush exceeded 2000ms)', still at 14:26Z. Our sends to Jordi fail with 'notify failed: tool_error: Tool execution failed unexpectedly' (his daily briefing pictures, 14:30Z). Restore the WhatsApp session now (the credential store write is too slow or stuck), confirm one test message reaches Jordi, then tell us the cause and how it is caught next time within minutes, not hours.
