# EPIC-8: Web3 / Venice angle — research line

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/EPIC-8-WEB3-VENICE-RESEARCH.md
Spine ID: web3-venice-angle-research-line
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Decide how Zenod can honestly be pitched to a web3 audience: private inference through Venice, optional crypto payment (stablecoins, or a user's own Venice/DIEM stake), and memory the user owns, as "web 2.5" rails on top of the unchanged web2 product. Brainstorm: [web3-venice-brainstorm-2026-11-01](research/web3-venice-brainstorm-2026-11-01.md).

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a crypto-audience promo video is a distribution channel for the first real and paying users (EPIC-7 testers, ZAL A5), if every claim in it is true.

## Done means

- [ ] E8-1 Privacy-surface map: who sees what per hop today (WhatsApp/Telegram, Zenod server, OpenRouter incl. the tenant-id `user` field, upstream model, vault host), and which claims are therefore true. Reviewed by Jordi.
- [ ] E8-2 Venice feasibility: `scripts/memory-eval` run of the librarian on at least one Venice Private (zero-retention) model vs the current model, plus cost per tenant per month and a file-level change list.
- [ ] E8-3 Rails decision: for L0 stablecoin checkout, L1 wallet login, L2 bring-your-own Venice/DIEM key, effort plus go/no-go recorded in Decisions (L2 needs a D30 exception).
- [ ] E8-4 Video positioning: a script/claims sheet where each claim is marked true today or after which lane.

## Current State

Owner: unassigned
Status: draft
Last attempted: 2026-11-01 brainstorm with Jordi; prior art searched (only the voice notes of 2026-08-27 and 2026-06-11 in obsidian-brain, no written analysis).
Result: brainstorm page written. Key finding: OpenRouter already sees no name, but it does see a stable tenant-id pseudonym and full memory content. Venice's Private tier fixes retention on that hop only; the Venice chat swap is small, metering/transcription/catalog are OpenRouter-shaped (medium).
Evidence: [research/web3-venice-brainstorm-2026-11-01.md](research/web3-venice-brainstorm-2026-11-01.md)
Waiting on:
- E8-A1 (Jordi): video publish date, and whether it may only claim what is live (waitlist for web3 lanes) or should wait for L0 + Venice-for-librarian.
- E8-A2 (Jordi): Venice for everyone by default, or an opt-in "private mode"? (Open-weight model quality is the trade-off.)
- E8-A3 (Jordi): stamp this epic `ready` to start T1–T2 (read-only audit + eval spike).
Approved work: none
Next action: on E8-A3, dispatch T1 (privacy-surface audit, read-only) and T2 (Venice eval spike) in parallel.
Source revision: main
Verified at: 2026-11-01

## Non-Goals

- No Zenod token.
- No change to the web2 path (card checkout, WhatsApp, email login) and no work ahead of milestone A gates (ZAL A0/A5).
- L4 protocol (crypto-paid operators, treasury, agent governance; 2026-06-11 vision) stays a horizon note, not a step.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | Ticket worker | unassigned | Privacy-surface audit (read-only): per-hop who-sees-what, hosted vault ownership, OpenRouter ZDR settings | draft | E8-A3 | none | main | none | 2026-11-01 | dispatch on ready |
| T2 | Ticket worker | unassigned | Venice spike: memory-eval on Venice Private model(s), cost/tenant, change list (aisdk base URL, metering, transcription, catalog) | draft | E8-A3; Venice API key (`secret find venice`) | none | main | none | 2026-11-01 | dispatch on ready |
| T3 | Ticket worker | unassigned | Rails survey: Stripe stablecoin acceptance, SIWE + Telegram path, BYO Venice key vs D30 | draft | T1 | none | main | none | 2026-11-01 | after T1 |
| T4 | Manager | unassigned | Video claims sheet + script | draft | E8-A1, T1 | none | main | none | 2026-11-01 | after E8-A1 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-01 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-01 | proposed | Position as "web 2.5": optional crypto rails, no own token | crypto stays opt-in, the web2 product is unchanged | brainstorm §3–4 | E8-3 |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
