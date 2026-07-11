# Ring SHIP test package — 2026-07-11

URL: https://ring.zenod.dev

Final immutable deployment: `5ac9f37652a3efddf79248bb8027530380f10bca` (`/api/health` reports `5ac9f37`).

## Result

**SHIP — PASS.** The real customer journey is complete: landing and pricing, GitHub account, Stripe TEST subscription, Council-first dashboard, tenant OpenRouter key entered through the UI, Zenod wired through My Units, visible durable commit receipt in Council chat, Ring's authenticated MCP face answering an external SDK client, persisted account state, and bearer-enforced two-tenant isolation.

The final SHIP 7 browser turn used the exact phrase `remember this: the ring is alive`. After the dashboard was fully initialized, the reply completed without a reload and visibly contained commit `45e22e251391b5233a5987fd3ae0a06a93d1347c` plus the Log and Inbox GitHub links.

## Journey ledger

| Step | Result | Evidence |
|---|---|---|
| 1 landing + pricing | PASS | `01-landing-pricing.png` |
| 2 GitHub sign-in | PASS | `02-github-signed-in.png` |
| 3 Stripe TEST subscription | PASS | `03-stripe-test-checkout.png` |
| 4 Council-first dashboard | PASS | `04-dashboard.png`; final-build dashboard `16-final-dashboard-b7c0ca5.png` |
| 5 capped OpenRouter key through UI | PASS | `05-openrouter-key.png`; key persisted masked |
| 6 Zenod wired through My Units | PASS | `06-wallet-zenod-connected.png`; final dashboard shows Zenod and Calli connected |
| 7 exact memory route + visible commit receipt | PASS | `19-ship7-live-authoritative-receipt.png`; commit and two GitHub links visible without reload |
| 8 Ring MCP face from external client | PASS | `12-external-mcp-chat-pass.png`; final-build SDK receipt below |
| 9 logout/login persistence | PASS | `13-authorized-lap-relogin.png`; final deployment preserved the same tenant state on `/data` |
| 10 two-tenant isolation | PASS | `14-authorized-lap-isolation-alpha.png`; final-build redacted API receipt below |

## Final-build external MCP receipt

An external `@modelcontextprotocol/sdk` client connected to the authenticated Ring URL, listed `chat_with_ring`, and called it on `5ac9f37`.

```json
{
  "initialize": {
    "status": 200,
    "server": { "name": "ring", "version": "0.0.1" }
  },
  "chat": {
    "isError": false,
    "text": "ring-face-ok",
    "conversationId": "mcp:ring-ship-5ac9f37-exact",
    "evidence": [{
      "kind": "chat_audit",
      "correlationId": "test_0427e20f7843459f9fa61c90f5a631d5"
    }]
  }
}
```

## Final-build two-tenant receipt

Two independently authenticated tenants queried the same deployment. Tenant B deliberately supplied tenant A's id in the query string; bearer scoping prevailed. The temporary beta tenant was deleted after the proof.

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
  "isolated": true,
  "cleanupStatus": 200
}
```

## Code, review, and deployment evidence

- Generic wallet mutation receipt gate: PR #869, merged `cc47b3a`; full CI passed; independent review passed.
- Authoritative stream completion: PR #882, merged `5ac9f37`; full CI passed; independent review passed.
- PR #882 focused validation: web 8/8, server health 20/20, web/server typechecks, web/server production builds; full repository CI build, Docker build, and tests passed.
- Publish-image workflow for `5ac9f37`: PASS, including runtime boot smoke.
- Guarded Ring-only cutover receipt: `/var/tmp/r-s5e-cutover-5ac9f37/health-receipt.json`.
- Live guarded routes: `/` 200, `/app` 200, `/healthz` 200, `/api/health` exact SHA, unauthenticated `/mcp` 401, GitHub OAuth callback pinned to `https://ring.zenod.dev/auth/github/callback`.
- Persistent `/data` was preserved. Existing Zenod, Calli, and customer services were not redeployed by this cutover.

## Generic MCP + Agent Skill hardening addendum

Final hardening deployment: `e6b0a2bb3777af223df8783c443811485be31588` (`/api/health` reports `e6b0a2b`).

**R-H1–R-H5 — PASS.** The existing saved Calli peer refreshed without reconnecting and now reports `tools ready · 18`. Its expanded wallet catalog shows the real namespaced MCP tools, including `createPosts`, `getUsersMe`, and `approve_send`; there is no synthetic `ask_calli` fallback in the wallet catalog. The canonical `callisthenes@1.0.0` skill is attached with three files and scripts stored inert.

The Council progressively loaded the attached skill and called the discovered namespaced `createPosts` tool once. Calli returned `[draft_not_approved]`, handle `dr_7281ac3`, and `status: held`; no `approve_send` call was made and nothing was published. Screenshot `22-hardening-held-draft-receipt.png` shows the held receipt beside the tools-ready wallet.

| Hardening gate | Result | Evidence |
|---|---|---|
| saved Calli refresh, no reconnect | PASS | `20-hardening-tools-ready-skill.png` |
| real 18-tool discovery, deterministic names | PASS | `21-hardening-calli-tools-expanded.png` |
| canonical skill attached and progressively loaded | PASS | `20-hardening-tools-ready-skill.png`; Council `load_peer_skill` event retained in chat |
| held draft only, no publish | PASS | `22-hardening-held-draft-receipt.png` |
| Ring MCP face answers external SDK client | PASS | `23-hardening-external-mcp.json` |
| two-tenant tools/key/skill isolation | PASS | `24-hardening-two-tenant.json`; beta deleted with HTTP 200 |
| exact immutable health and OAuth boundary | PASS | `25-hardening-health-receipt.json` |

The live lap found and closed two integration-only defects before signoff:

- PR #889 (`563821a`) omits an oversized optional peer `outputSchema` instead of rejecting the whole usable catalog; input schemas and catalog limits remain strict.
- PR #890 (`e6b0a2b`) allows a dynamically namespaced mutation only for `run|execute` bound to the exact tool leaf. Cross-tool intent, substrings, read-only requests, pre-verb negation, and later cancellation all fail closed; legacy outbound approval tokens remain unchanged.

Both PRs passed full CI and independent security review. The final temporary beta tenant saw zero peers, no OpenRouter key, and a 404 for Calli's skill even while supplying the alpha-facing query value; it was deleted after the proof.

## Diagnostic trail retained

Earlier screenshots `07`, `11`, `15`, and `17` intentionally retain the sequence of live failures: downstream timeout, malformed poll path, omitted receipt, and streamed draft winning over the authoritative reply. `18-reload-shows-authoritative-receipt.png` proved persistence before PR #882; `19` is the final no-reload browser pass.
