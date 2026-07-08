# EPIC 2.6 · HERALD MOVE 0 — the money: the loop, sold with one button

Owner: pen held by Jordi (direct dispatch); Story-Fable scribes/audits at hand-back · Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md)
Origin: Jordi × Story-Fable, 2026-07-05 — converged after the one-room-ring resolution.
Depends on: [EPIC-2.3-ZENOD-MOVE-0.md](EPIC-2.3-ZENOD-MOVE-0.md) (funnel machinery, Zenod unit) ·
[EPIC-2.4-CALLISTHENES-MOVE-0.md](EPIC-2.4-CALLISTHENES-MOVE-0.md) (the mouth — H-4 posting blocks on its C-1) ·
2.5's SEAM-SPEC (unedited) · Product story: [loop-product-promo-v4.html](loop-product-promo-v4.html).

**EXIT CRITERION:** a customer clicks one button (~$200/mo LIVE — HD-1), gets a provisioned stack
(ring nucleus + Herald + Zenod + Callisthenes, tokens wired, metered, watchdogged), pairs WhatsApp
by QR, negotiates the briefing to approval, receives the morning ten (each proposal citing its
memory source), approves three, sees them posted with permalink receipts, and gets the weekly
report. Jordi runs it first as customer #1; a tester repeats as a stranger. **Supervised mode at
launch (HD-2): every post carries the customer's ✓.**

## THE CONVERGED DESIGN (settled 2026-07-05 — do not relitigate)

**Herald ships living inside a one-room ring.** WhatsApp is never wired into Herald.

- **Ring nucleus** = the REAL ring at minimum size: Phylax gateway container (Baileys/QR, per
  RD-1 as decided in 2.5) + a tiny core: durable mailbox, provenance, **verbatim attributed
  relay**, and a routing table with one row: `* → Herald`.
  **Explicitly OUT of scope: keyring UI, LLM classifier, attention rules, council guy.** Those
  are 2.7 rooms. Any of them appearing in this epic is scope failure.
- **Herald** = one guy container: smart LLM, MCP server shell (BYO-ring customers point their own
  ring at it — document the endpoint), MCP client to exactly Zenod + Callisthenes (per-unit
  tokens injected at provision; never world keys), **turn preamble reads the briefing + standing
  directives from Zenod every turn**, practices scheduler in-process (NO Epaminon, NO Archus —
  the queue lives in memory pages).
- **Modularity is config:** Herald's memory = a seam URL + token (swap for any conformant
  memory); his mouth likewise. Hosted buyers never see these knobs; self-hosters get them in the
  compose file.
- Nucleus code is the first installment of 2.7 — shared lineage, never a fork.

## HD decisions

- **HD-1 · Price — ~$200/mo** (Jordi 2026-07-05 signal; final number via Product-Fable). One SKU,
  credits for LLM spend per the ZD-5/D-5 pattern.
- **HD-2 · Supervised at launch — RECOMMENDED DECIDED:** every post requires ✓ until the
  unattended soak passes (the 2.5-canon rule). Auto-send graduates later per lane config.
- **HD-3 · Customer #0 = the Zenod project itself** (dogfood: Herald runs zenod's public
  presence before/alongside customer #1). Recommended: it's the demo AND the launch content.

## Iteration 0 — lanes

| ID | Lane | Deliverable + acceptance | Test criteria (tester, fresh evidence) |
|---|---|---|---|
| **H-1** | Ring nucleus | Phylax gateway container + nucleus core extracted from fused Console; one-row routing; verbatim attributed relay enforced structurally; durable mailbox; QR pairing runbook | fresh boot: QR pair → "hello" → relayed to a stub guy and back verbatim with attribution; transcript shows zero composition; restart mid-conversation resumes |
| **H-2** | Herald brain | guy container per design above; briefing-negotiation flow (draft → questions → iterate → ✓ = memory page one); morning-N proposals ritual (each citing memory source, reactions filed back); MCP endpoint documented for BYO-ring | via nucleus WhatsApp: decks+voice note → briefing v1 with questions → approve → next morning ten proposals with citations; "✓ 1,3 + give me five more" round-trip; reactions visible as memory commits |
| **H-3** | Buy button | herald site page (copy via Epic 0) + Stripe LIVE SKU (HD-1) → webhook → provision full stack (nucleus+Herald+Zenod+Callisthenes, tokens, meter/credits, watchdog registration) — machinery cloned from 2.3/2.4 | real card → stack live + QR delivered, zero human touch; all containers in watchdog; credits meter on Herald's key |
| **H-4** | The practice v0 (blocks on 2.4 C-1) | daily proposals lane + paced posting via Callisthenes (supervised ✓ per HD-2) + reply reading + lessons filed to memory | approved post → permalink receipt in chat + filed in memory; unapproved never sends (C-22 probe); a reply drafted grounded, held for ✓; lesson visible as memory commit |
| **H-5** | Scorecard v0 | weekly report as a chat message: proposals approved-untouched %, posts, goal metrics from the briefing; no UI | after a seeded week: report arrives, numbers reconcile with receipts |
| **H-6** | Customers #0 and #1 | HD-3 dogfood live; then Jordi's full funnel run | scored ✅/❌ against the exit criterion, receipts inline |

Sequencing: H-1 ∥ H-2 ∥ H-3-page now (H-2 tests via H-1) · H-4 after 2.4 C-1 green · H-5 with H-4
· H-6 last · tester's stranger run closes.

## Boundaries
- ↔ 2.4: Herald posts ONLY through the Callisthenes unit — no outbound keys in Herald, ever.
- ↔ 2.5/2.7: nucleus = ring lineage; keyring/classifier/attention/council = 2.7 only.
- ↔ Epic 0: site copy, briefing voice, launch materials (gated: Herald marketing publishes only
  after HD-3's loop is real — receipts culture applies to marketing).
- Jordi is the only router between tracks.

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

### 2026-07-05 · [scribe/Story-Fable] Doc created
- Materializes the one-room-ring convergence (chat, 2026-07-05): nucleus ships with Herald,
  additive growth to 2.7, modularity as config. Lanes H-1..H-6; HD-1..HD-3 framed.

### 2026-07-08 · [worker] Move-0 scaffold installment — H-1 ∥ H-2 ∥ H-3-page (blueprints)
Landed the binding scaffold layer that unblocks the three now-parallel lanes. Blueprint/scaffold
only (doc-PR lane) — NO extraction code, NO live Stripe SKU, NO WhatsApp pairing were built or
CI-verified this session (see "budget / stop-honestly" below). Files (see PR #626):
- **H-1 · Ring nucleus** — new `units/ring-nucleus/` (README, SEAM-SURFACE, EXTRACTION-MAP,
  docker-compose.nucleus.yml). The MINIMUM nucleus scoped distinct from the 2.7 full ring
  (`units/ring/`): four responsibilities only — durable mailbox, provenance, **verbatim attributed
  relay**, static **one-row route `* → Herald`**. Keyring UI / LLM classifier / attention-rules /
  council guy each named OUT (scope failure if present, per epic line 24). EXTRACTION-MAP is a
  strict subset of the ring's, citing the SAME real files (`whatsappGateway.ts`, `whatsappStore.ts`,
  `conversationTranscript.ts`, `peerClient.ts`, `meshGateway.ts` forwarding half) — first additive
  installment of 2.7, never a fork.
- **H-2 · Herald guy** — new `units/herald/` (README, SEAM-SURFACE, docker-compose.herald.yml).
  One guy container: MCP server shell (BYO-ring endpoint documented) + MCP client to EXACTLY Zenod
  (memory) + Callisthenes (mouth = OUTBOUND_AGENT "Callistheness"); turn-preamble reads briefing
  from Zenod every turn; in-process practices scheduler (no Epaminon/Archus); briefing-negotiation
  + morning-N ritual (each proposal cites its memory source); **supervised HD-2 — no auto-send
  path**; unit tokens only, never world keys; posts ONLY through Callisthenes. `HERALD_AGENT`
  addition to `agent.ts` described as a FUTURE code step (not edited).
- **H-3 · Buy button (page + plan)** — new `sites/herald/index.html` (scaffold, `[DRAFT — Epic 0
  voice pending]`, CTA `href="#"` TODO for the LIVE ~$200/mo SKU) + `docs/HERALD-BUY-BUTTON-PLAN.md`
  (provisioning wiring cloned from the proven Zenod path: `zenod-ai/cloud` control plane, Z-2
  machinery, `scripts/gateway/openrouter-key.mjs`, `scripts/watchdog/`, ZD-5/D-5 credits). Maps each
  step reuse-vs-NEW for the 4-container stack; HD-1/HD-2/HD-3 stated; H-3 acceptance checklist
  included. Blueprint only — no live SKU, no keys.

Budget / stop-honestly: this worker delivered the scaffold/design installment via the doc-PR lane.
The executable halves — ring-core extraction from the fused Console, a LIVE Stripe SKU, WhatsApp QR
pairing (H-1/H-2/H-3 code), plus H-4 (blocks on 2.4 C-1 tester-green), H-5, and H-6 (Jordi's) — are
multi-session, Docker/WhatsApp/Stripe-dependent code jobs that cannot be CI-green-verified in this
environment; shipping them here would be self-certification. They follow as CI-gated code PRs.
Nucleus vs full-ring boundary and the supervised-no-auto-send invariant are held structurally in the
scaffolds. Receipt: PR https://github.com/zenod-ai/zenod/pull/626 → merged to main 2026-07-08 as
squash commit `a0050187734b88c5d040e24ae9e4c5d0f5be4c00` (CI `ci` green).
