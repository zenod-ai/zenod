# EPIC 2 · HOSTED PRODUCT READINESS

Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md) · Positioning: launch deck V5 · Journeys: user-journeys deck (T1, J7–J9)
**Exit criterion: a stranger pays money and gets a working Council attached to their repo. Jordi is customer #0 and doesn't count.**

Status: 🟡 SCOPING. **Gated by Epic 1** — no executor capacity until stability P0s close. The only work
allowed now is the D-1 decision and this document.

---

## The launch product (Jordi, 2026-07-03)

**The launch SKU is the three-role project council:** a council attached to a PROJECT repo — memory
about the project, not the person — running the planner→executor→tester loop against one living
iteration doc. The generic personal council stays as a configuration users can turn on (voice notes,
ad-hoc Epaminon, memory Q&A) — we don't lose it, we just don't lead with it. Jordi is customer #0 of
the project council. Self-hosting is not core to this product; open-source likely but optional — decide
later, create no legacy now.

## Step 0 gate · D-1: hosting shape — DECIDED

| Option | Time to first invoice | Risk |
|---|---|---|
| **A. Managed single-tenant** — one container per customer, the exact image we dogfood, provisioned by us | ~days | ops toil per customer; fine at first 10–50 |
| B. Multi-tenant shell | weeks+ | rewrite of settings/auth/storage mid-stabilization |
| C. Self-host only (docs + docker run) | ~days | no recurring revenue muscle; support burden |

**DECIDED 2026-07-03 (Jordi): A — managed single-tenant.** Same image we dogfood, one container per
customer. Self-host stays as funnel (C), B deferred until revenue proves it.

## Tickets (high level — refined into acceptance-criteria form once D-1 is decided and Epic 1 exits P0)

### H-1 · Provisioning path: signup → running Council  (P0)
One command/script that stands up a customer container (image, volumes, env, WhatsApp or web channel),
scaffolds the vault repo (schema v1 commit), and returns the customer's console URL. This is J7 with us
pressing the button; automation comes later.
**Accept:** a fresh test customer provisioned end-to-end in <30 min without editing code.

### H-2 · Checkout: a button that charges money  (P0)
Stripe checkout on the site (apps/site), one plan to start, webhook → provisioning queue (H-1 manual
fulfillment is acceptable at launch). No invoicing by hand.
**Accept:** a real card (Jordi's) completes checkout in prod; subscription visible in Stripe; provisioning
task created with the customer's details.

### H-3 · Bring-your-own credentials onboarding  (P0)
Guided connect: GitHub (vault repo — GitHub App, not PATs), X, Google Drive; each connection visibly
unlocks its journeys (J8). Secrets stored per-tenant, never in the vault.
**Accept:** a non-technical tester connects GitHub + X unaided in <20 min.

### H-4 · Onboarding interview → first backlog  (P1)
J9: the Council interviews the new customer (what do you do, for whom, what voice), files answers as
memory, proposes the first post backlog on the board.
**Accept:** fresh tenant reaches a reviewable first backlog within one session.

### H-5 · Operator guardrails for strangers  (P1)
Throttles, quiet hours, spend caps, and the approval gates from Epic 1 — configured per tenant with sane
defaults. What makes "an agent posts as my company" safe enough to buy.
**Accept:** default tenant cannot exceed N posts/hour or $X/day model spend; caps visible and editable.

### H-6 · Public proof: dogfood in the open  (P2, continuous)
Zenod's own X/Reddit presence run by Zenod (T0 loop), TrustMRR listing once revenue exists. The growth
chart is the sales page.
**Accept:** T0 loop posting on the real account under H-5 guardrails; TrustMRR listed at first MRR.

---

## Non-goals at launch
Multi-tenant architecture (that's option B, later). Marketplace/agents-for-hire. Composio long-tail
connectors. Anything that competes with Epic 1 for workers.

## Worker/tester append zone (same doc, never a new file)

<!-- executors and testers: add dated entries below this line; deliverable URLs mandatory -->
