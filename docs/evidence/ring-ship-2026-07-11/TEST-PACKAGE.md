# Ring SHIP test package — 2026-07-11

URL: https://ring.zenod.dev

Deployed immutable commit: `fde458fa50818b9b125572d01fa4eb613f7f867c` (`/api/health` reports `fde458f`).

## Result

The live journey is **not yet SHIP**. Steps 1–6 and the wallet-connect portion of 7 passed. Step 7 routed `remember this: the ring is alive` to the connected Zenod, but the UI remained at “Saving to Zenod’s memory” and did not show a commit receipt within the required 180 seconds. The final allowed fix lap was already consumed, so this package freezes the evidence instead of inventing another implementation lap.

Step 8's external MCP transport and read-only tool call passed. Its mutating `chat_with_ring` call reached Ring but was rejected by the receipt middleware as `silent_ack` because the successful result supplied neither `evidence[]` nor a structured error; therefore the required council reply did not pass. Step 9 persistence and live two-tenant wallet/key isolation passed.

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

## Live two-tenant proof

Two bearer-authenticated tenants queried the same exact deployment. A tenant-B request deliberately supplied tenant A's id in the query string; server-side bearer scoping prevailed.

```json
{
  "alpha": {
    "status": [200, 200],
    "peerNames": ["Zenod"],
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

- PR #853 final fix CI: PASS.
- Publish-image workflow for `fde458f`: PASS.
- Guarded Dokploy cutover receipt: `/var/tmp/r-s5-cutover-fde458f/health-receipt.json`.
- Live routes: `/` 200, `/app` 200, `/healthz` 200, `/api/health` exact SHA, unauthenticated `/mcp` 401.
- External MCP initialize: HTTP 200, protocol `2025-03-26`, server `ring` `0.0.1`.
- External read-only tool call: HTTP 200 with Ring's OpenRouter usage timeline.

## BLOCKED ON JORDI

Authorize one additional fix lap for the two related acceptance failures: surface the downstream Zenod async commit receipt in Council chat, and make `chat_with_ring` return receipt-middleware-compliant evidence so an external client receives the council reply.
