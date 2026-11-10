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

Owner: run_94349079 (T1 round 2)
Status: active
Last attempted: 2026-11-10T11:55Z T1 round 2: the invite is one link with the code inside (cloud.zenod.dev/join?code=…): sign-in, checkout with the code applied, a You're in page; live on 51c0fe51; diagram and screens on desktop and phone
Result: E26-1 met on production; E26-2 invite text is one line, the three things and the one link, with {CODE} until a code exists; no welcome email (Zenod has no mailer); checkout with the code not seen live yet; T1 in review
Evidence: [funnel and screens](http://vps3.taild81fbb.ts.net:8921/e26-t1/), [e26-t1-r2](evidence/e26-t1-r2-2026-11-10.md), card docs/cards/E26-T1.md
Waiting on: Jordi, T1 card verdict; E26-A2 (tester-code command, Mac list); E23-A1 (who the first tester is)
Approved work: none
Next action: on E26-A2 and E23-A1, issue that person's code, hand Jordi the filled invite and watch the sign-up live (proves checkout with the code)
Source revision: 51c0fe51
Verified at: 2026-11-10T11:42Z (health sha 51c0fe51, live join and testers pages screenshotted)

## Waiting on

- [ask E26-A2: do @Jordi since 2026-11-10 row T1 · needs Mac agent] Run the one bootstrap command from E26-A1 on your Mac (about 2 minutes, you only start it) — context: you approved the tester-code command; installing it needs root on VPS1, which only your key has, and agents checked their own rights: no such command yet — impact: the first invite gets its code, and every later one — risk: low, as in E26-A1 — recommend: run it now — why Jordi: only your laptop holds the root key — bootstrap: the same command as in E26-A1 above — unblocks: T1, E23-A1 invite
- [answered E26-A1 2026-11-10 @Jordi · done 2026-11-10 59dcfd72 approval recorded, install is E26-A2] Let agents make tester codes themselves, with one fixed command on VPS1 that can only create a free single-use tester code or show code status (about 2 minutes, you only start it) — context: the tester page now opens with the three promises (live at zenod.dev/testers) and the first invite is written, but it still says {CODE}: making a code needs the live Stripe key, which only root reads on VPS1, and agents' root access no longer includes the code command — impact: the first invite, and every later one, gets its code in minutes without you — risk: low; the command can only create free single-use codes on the existing tester coupon, nothing is ever charged; rollback: remove the command — recommend: yes, so the invite you send is complete — why Jordi: root on VPS1 is your key — bootstrap: claude "Read ask E26-A1 in https://github.com/zenod-ai/zenod/blob/main/docs/tester-invite-three-clear-promises-first.md. With my VPS1 root access, add one root-only wrapper that runs only the Zenod tester-code script with the arguments issue or status (scripts/stripe-testers.mjs in zenod-ai/zenod), allow the agent account to run just that wrapper, test that issue creates one code and nothing else can run, then append what you did to the E26-A1 line, commit and push." — unblocks: T1, E23-A1 invite — details: [first invite](http://vps3.taild81fbb.ts.net:8921/e26-t1/) — answer: APPROVED

## Non-Goals

- Claims that are not true of production today.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | Ticket worker | run_94349079-03e3-472e-a05c-d33608694772 (round 2 finish; round 2 build run_9ca8cb40) | E26-1, E26-2: the three promises on the tester page and the invite; round 2 (Jordi 2026-11-10 "you make a click and you go through the funnel"): one invite link with the code inside, sign-in, checkout with the code applied, a you're-in step | review | none | [#1581](https://github.com/zenod-ai/zenod/pull/1581) merged ce1181e; [#1593](https://github.com/zenod-ai/zenod/pull/1593) merged ffa1659b; invite text 5559c414 | main | [live funnel and screens](http://vps3.taild81fbb.ts.net:8921/e26-t1/), [e26-t1-r2](evidence/e26-t1-r2-2026-11-10.md): cloud.zenod.dev/join?code=… live on 51c0fe51 (health read 2026-11-10T11:40Z): invite page, Google or GitHub sign-in, Stripe Checkout with the code prefilled (€0, no card), You're in page; diagram and desktop and phone screens; no welcome email (Zenod has no mailer, Stripe sends no receipt at €0); checkout step not seen live (no agent Stripe key or sign-in), proven by tests | 2026-11-10T11:55Z | followups: start welcome email after checkout — Zenod has no sender today, a mail to testers is ask-tier; start lighter tester checkout — prefill their email and check if the billing address can go at €0; started E26-A2 (tester-code command, on Jordi's Mac list); confirm: yes — Jordi opens the link and the screens and says if this is the funnel he meant |
| E26-S1 | Ticket worker | unassigned | Tester funnel: a code, one link to sign up and pay, a welcome email: The invite ends in one link: the tester gets a code, picks an email, signs up and pays at checkout using the code (a Stripe coupon), then gets an email saying they are provisioned, with their WhatsApp number and next steps. | done (no confirm: same work as T1 round 2, which builds it) | none | none | main | none | 2026-11-10 | covered by T1 round 2 |
| E26-S2 | Ticket worker | unassigned | Tester flow, live: public apply link, a one-time coupon by email: No hand-picked first tester: live with people from the internet. One public link: they apply with their email; each accepted applicant gets a one-time coupon issued only for them, by email, used at checkout. Draw the whole flow for Jordi on one page. | ready | none | none | main | none | 2026-11-10 | dispatch (Jordi's ask, L-37) |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | epic “Tester invite: three clear promises, first invite out” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-10 03:54Z Zenod: Log/2026-11-10.md#^e-ecf0b8 I think there is this diagram in ") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | Planned from Jordi's voice note (WhatsApp 2026-11-10 03:54Z, Zenod Log 2026-11-10 ^e-ecf0b8); ready on his ask (L-37); works with EPIC-23 ask E23-A1 (he names the first tester) | T1 makes the page and invite plain and ready; sending stays his | his voice note | when T1 is in review |
| 2026-11-10 | accepted | E26-S1 ready on Jordi's ask (L-37, Team desk: "📎 Also in this note (vn_c837c0f6): workflow for the campaign; user registration with a code; single link for authentica") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | E26-S2 ready on Jordi's ask (L-37, Team desk: "📎 Also in this note (vn_8bd5796f): Clarify the flow for testers; Change to live testing with internet users; Issue one-") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
