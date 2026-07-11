# Ring SHIP test package — 2026-07-11

URL: https://ring.zenod.dev

Deployed immutable commit: `fde458fa50818b9b125572d01fa4eb613f7f867c` (`/api/health` reports `fde458f`).

## Result

The live journey is **not yet SHIP**. Jordi authorized one additional receipt-only fix lap. The resulting exact build `a729d08304ef49412e72fe5739fb3b51762721d2` passed CI, guarded deployment, SHIP 8 external MCP chat, logout/login persistence, and two-tenant isolation. SHIP 7 still failed: `remember this: the ring is alive` held the Council UI for the complete polling window, then returned “queued … I'll confirm once it's filed” without the required Zenod commit SHA/URL.

The authorized lap fixed SHIP 8: external `initialize` returned Ring `0.0.1`, and `chat_with_ring` returned HTTP 200, `isError=false`, a Council reply, and correlation-backed `chat_audit` evidence. Step 9 persistence and live two-tenant wallet/key isolation passed again on the same build.

## Journey ledger

| Step | Result | Evidence |
|---|---|---|
| 1–2 landing + pricing | PASS | `01-landing-pricing.png` |
| 3 GitHub sign-in | PASS | `02-github-signed-in.png` |
| 4 Stripe TEST subscription | PASS | `03-stripe-test-checkout.png` |
| 5 dashboard | PASS | `04-dashboard.png` |
| 6 capped OpenRouter key through UI | PASS | `05-openrouter-key.png`; key accepted and persisted masked |
| 7 Zenod wallet | PARTIAL | `06-wallet-zenod-connected.png` passed; `07-remember-receipt.png` captures the missing receipt after 180 seconds |
| 8 external MCP face | PARTIAL | initialize returned Ring server info and `read_llm_timeline` returned HTTP 200; mutating chat returned `silent_ack`; `08-ring-mcp-external.png` is the live Ring endpoint/usage reference |
| 9 logout/login persistence | PASS | `09-relogin-persistence.png` |
| 9 two-tenant isolation | PASS | `10-two-tenant-isolation-alpha.png` plus the redacted live API proof below |
| Authorized-lap SHIP 7 | FAIL | `11-authorized-lap-receipt-timeout.png`; no commit receipt after the full polling window |
| Authorized-lap SHIP 8 | PASS | `12-external-mcp-chat-pass.png`; external response recorded below |
| Authorized-lap SHIP 9 persistence | PASS | `13-authorized-lap-relogin.png` |
| Authorized-lap SHIP 9 isolation | PASS | `14-authorized-lap-isolation-alpha.png` plus redacted API proof below |

## Authorized-lap external MCP proof

```json
{
  "initialize": {
    "status": 200,
    "server": { "name": "ring", "version": "0.0.1" }
  },
  "chat": {
    "status": 200,
    "isError": false,
    "evidence": [{ "kind": "chat_audit", "conversationId": "mcp:ring-ship-final-a729d08" }]
  }
}
```

## Live two-tenant proof

Two bearer-authenticated tenants queried the same exact deployment. A tenant-B request deliberately supplied tenant A's id in the query string; server-side bearer scoping prevailed.

```json
{
  "alpha": {
    "status": [200, 200],
    "peerNames": ["Zenod", "Calli"],
    "provider": "openrouter"
  },
  "beta_cross_query": {
    "status": [200, 200],
    "peerCount": 0,
    "provider": null,
    "openrouterKeyPresent": false
  },
  "isolated": true
}
```

## Automated and deployment evidence

- PR #856 and #857 CI: PASS; independent receipt/security review: PASS after per-poll wallet SSRF validation was added.
- Publish-image workflow for `a729d08`: PASS.
- Guarded Dokploy cutover receipt: `/var/tmp/r-s5-cutover-a729d08/health-receipt.json`.
- Live routes: `/` 200, `/app` 200, `/healthz` 200, `/api/health` exact SHA, unauthenticated `/mcp` 401.
- External MCP initialize: HTTP 200, protocol `2025-03-26`, server `ring` `0.0.1`.
- External read-only tool call: HTTP 200 with Ring's OpenRouter usage timeline.

## BLOCKED ON JORDI

The authorized additional lap is exhausted. Decide whether to authorize another focused diagnosis/fix lap for the remaining live Zenod async receipt timeout, or stop Ring SHIP here.
