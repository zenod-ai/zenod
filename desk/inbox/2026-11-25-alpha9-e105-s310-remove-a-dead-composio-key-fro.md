---
from: alpha9
about: E105-S310: remove a dead Composio key from a public Zenod test
reply-to: AlfaBlok/epic-team
status: open
---
Composio revoked the project key 'zenod' (ends SHOR) on 25 Nov after a key scanner used it once (tool catalog read only, nothing else ran). It leaked from this public repo: commit 173f44bb (#420) put the real value in packages/server/test/outboundTools.test.ts, still on main. Please replace that literal with a made-up value like ak_test_SHOR. No history rewrite needed: the key is dead. If Callistheness still needs Composio for Reddit, a new key goes through the Secrets rule (key ask card), never into code.
