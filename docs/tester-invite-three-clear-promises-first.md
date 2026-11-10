# EPIC-26: Tester invite: three clear promises, first invite out

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/tester-invite-three-clear-promises-first.md
Spine ID: tester-invite-three-clear-promises-first-invite-out
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Tester page and invite say plainly what a tester gets: a WhatsApp number to drop voice notes; a literal copy of their memory in their own account; a knowledge graph with MCP so any AI reads and writes it. Make the first invite ready for Jordi to send to someone he knows.

Goal sentence: The tester page and invite say plainly what testers get, and the first invite is ready to send.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): the first tester only says yes if the promise is clear.

## Done means

- [ ] E26-1 zenod.dev/testers and the invite say three things plainly: a WhatsApp number to drop voice notes; a literal copy of your memory in your own account; a knowledge graph with MCP so any AI reads and writes it
- [ ] E26-2 The first invite is ready for Jordi to send to someone he knows (filled in, with the tester code and link), and it is sent

## Current State

Owner: run_dcd204c7 (T1)
Status: active
Last attempted: 2026-11-10T04:45Z T1: zenod.dev/testers leads with the three promises, live on ce1181e (PR #1581); first invite written, its tester code not made (agents lack the root line)
Result: E26-1 met on production, in review; E26-2 invite text ready with {CODE} placeholder, not sent
Evidence: [e26-t1](evidence/e26-t1-2026-11-10.md), [page](http://vps3.taild81fbb.ts.net:8921/e26-t1/), card docs/cards/E26-T1.md
Waiting on: Jordi, T1 card verdict; E23-A1 (who the first tester is); proposed ask: a narrow root line so agents make tester codes (in the T1 evidence, for the Delivery manager to post)
Approved work: none
Next action: post the tester-code ask; on E23-A1's name, issue that person's code and hand Jordi the filled invite
Source revision: ce1181e
Verified at: 2026-11-10T04:45Z (health sha ce1181ec, live page read)

## Waiting on

- [ask E26-A2: do @Jordi since 2026-11-10 row T1 · needs Mac agent] Run the one bootstrap command from E26-A1 on your Mac (about 2 minutes, you only start it) — context: you approved the tester-code command; installing it needs root on VPS1, which only your key has, and agents checked their own rights: no such command yet — impact: the first invite gets its code, and every later one — risk: low, as in E26-A1 — recommend: run it now — why Jordi: only your laptop holds the root key — bootstrap: the same command as in E26-A1 above — unblocks: T1, E23-A1 invite
- [answered E26-A1 2026-11-10 @Jordi · done 2026-11-10 59dcfd72 approval recorded, install is E26-A2] Let agents make tester codes themselves, with one fixed command on VPS1 that can only create a free single-use tester code or show code status (about 2 minutes, you only start it) — context: the tester page now opens with the three promises (live at zenod.dev/testers) and the first invite is written, but it still says {CODE}: making a code needs the live Stripe key, which only root reads on VPS1, and agents' root access no longer includes the code command — impact: the first invite, and every later one, gets its code in minutes without you — risk: low; the command can only create free single-use codes on the existing tester coupon, nothing is ever charged; rollback: remove the command — recommend: yes, so the invite you send is complete — why Jordi: root on VPS1 is your key — bootstrap: claude "Read ask E26-A1 in https://github.com/zenod-ai/zenod/blob/main/docs/tester-invite-three-clear-promises-first.md. With my VPS1 root access, add one root-only wrapper that runs only the Zenod tester-code script with the arguments issue or status (scripts/stripe-testers.mjs in zenod-ai/zenod), allow the agent account to run just that wrapper, test that issue creates one code and nothing else can run, then append what you did to the E26-A1 line, commit and push." — unblocks: T1, E23-A1 invite — details: [first invite](http://vps3.taild81fbb.ts.net:8921/e26-t1/) — answer: APPROVED

## Non-Goals

- Claims that are not true of production today.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | Ticket worker | run_dcd204c7-29b6-4957-95a2-de3c83044505 | E26-1, E26-2: the three promises on the tester page and the invite, and the first invite ready to send | review | none | [#1581](https://github.com/zenod-ai/zenod/pull/1581) merged ce1181e | main | [e26-t1](evidence/e26-t1-2026-11-10.md), [page](http://vps3.taild81fbb.ts.net:8921/e26-t1/): zenod.dev/testers leads with the three promises, live on ce1181e (deployed 2026-11-10T04:38Z); invite for WhatsApp or email written in [invite-dm](epic7/invite-dm.md), Reddit DM updated too; tester code not made: agents' VPS1 root list has no issue line | 2026-11-10T04:45Z | followups: start tester-code ask — agents cannot make the code the invite needs (root line on VPS1); start EPIC-23 U2 on E23-A1's name — issue that person's code, hand Jordi the filled invite; confirm: yes — Jordi reads the live page and the invite and says if the three promises land |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | epic “Tester invite: three clear promises, first invite out” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-10 03:54Z Zenod: Log/2026-11-10.md#^e-ecf0b8 I think there is this diagram in ") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | Planned from Jordi's voice note (WhatsApp 2026-11-10 03:54Z, Zenod Log 2026-11-10 ^e-ecf0b8); ready on his ask (L-37); works with EPIC-23 ask E23-A1 (he names the first tester) | T1 makes the page and invite plain and ready; sending stays his | his voice note | when T1 is in review |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
