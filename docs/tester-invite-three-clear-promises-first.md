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

Owner: run_7b98678e (E26-S2, answers T1's relaunch)
Status: active
Last attempted: 2026-11-10T17:25Z E26-S2: the full tester picture on one page; the server now accepts the first 10 applicants itself and creates each a Stripe code and email; live on 0274bf2f
Result: E26-1 met; application and acceptance live; invites are created automatically, never by hand; Stripe code making waits on one permission tick or E26-A2; emails wait on a Resend key; welcome email to build; E26-S2 and T1 in review on one page
Evidence: [full tester picture](http://vps3.taild81fbb.ts.net:8921/e26-s2/), [e26-s2](evidence/e26-s2-2026-11-10.md), cards docs/cards/E26-S2.md and docs/cards/E26-T1.md
Waiting on: E26-A3 (needs Mac agent: one Stripe setting so Zenod makes each code) ; E26-A4 (a Resend key so Zenod can email the link)
Approved work: none
Next action: post the mail key ask and the code permission ask from the E26-S2 page; once both land, watch the first stranger's sign-up live
Source revision: 0274bf2f
Verified at: 2026-11-10T17:24Z (health sha 0274bf2f ok; live form refuses non-emails; admin and code queue closed without auth)

## Waiting on

- [ask E26-A3: do @Jordi since 2026-11-10 row E26-S2 · needs Mac agent] In Stripe, set "Promotion codes" to Write on the key named zenod-mt 2026-11 (about 1 minute); this replaces E26-A2 — context: testers are now accepted by Zenod itself (live, first 10, cap and stop switch); each acceptance makes a one-time Stripe promotion code for that person, but production's Stripe key can read codes and not create them — impact: every accepted tester gets their own code with nobody in the loop; E26-A2 (the root command) is then not needed — risk: low; the key can only create codes on the existing free tester coupon, nothing is charged; rollback: set it back to Read — recommend: yes, this one change instead of E26-A2 — why Jordi: only your Stripe login can change a key — bootstrap: claude "In my Stripe dashboard (Developers, API keys, restricted keys), open the key named zenod-mt 2026-11, set Promotion codes to Write, save, then append what you did to ask E26-A3 in https://github.com/zenod-ai/zenod/blob/main/docs/tester-invite-three-clear-promises-first.md and push." — unblocks: E26-S2 — details: [the full flow](http://vps3.taild81fbb.ts.net:8921/e26-s2/)
- [ask E26-A4: provide @Jordi since 2026-11-10 row E26-S2] Make a free Resend account and paste one key (about 4 minutes) — context: testers are now accepted by Zenod itself, but it cannot email them their personal link because Zenod has no mail sender (agent_team's team email only sends to you, so it cannot carry these) — impact: every accepted tester gets their link in minutes with nobody in the loop, and the welcome email can follow — risk: low; the key only sends mail from zenod.dev and is removed in one step; nobody is mailed who did not apply — recommend: yes, Resend, free, no card — why Jordi: a new account needs your login — steps: open https://resend.com/signup, sign up with Google, open https://resend.com/api-keys, Create API key named zenod-mt with "Sending access", paste it into the card; then agents add the zenod.dev sending records in Cloudflare, verify the domain and send a test to your own address before any tester gets one — secret: zenod-mt RESEND_API_KEY — unblocks: E26-S2 — details: [the full flow](http://vps3.taild81fbb.ts.net:8921/e26-s2/)
- [answered E26-A2 2026-11-10 @Delivery-Manager · done 2026-11-10 0274bf2f superseded by E26-A3 (one Stripe setting instead of a root command)] Run the one bootstrap command from E26-A1 on your Mac (about 2 minutes, you only start it) — context: you approved the tester-code command; installing it needs root on VPS1, which only your key has, and agents checked their own rights: no such command yet — impact: the first invite gets its code, and every later one — risk: low, as in E26-A1 — recommend: run it now — why Jordi: only your laptop holds the root key — bootstrap: the same command as in E26-A1 above — unblocks: T1, E23-A1 invite
- [answered E26-A1 2026-11-10 @Jordi · done 2026-11-10 59dcfd72 approval recorded, install is E26-A2] Let agents make tester codes themselves, with one fixed command on VPS1 that can only create a free single-use tester code or show code status (about 2 minutes, you only start it) — context: the tester page now opens with the three promises (live at zenod.dev/testers) and the first invite is written, but it still says {CODE}: making a code needs the live Stripe key, which only root reads on VPS1, and agents' root access no longer includes the code command — impact: the first invite, and every later one, gets its code in minutes without you — risk: low; the command can only create free single-use codes on the existing tester coupon, nothing is ever charged; rollback: remove the command — recommend: yes, so the invite you send is complete — why Jordi: root on VPS1 is your key — bootstrap: claude "Read ask E26-A1 in https://github.com/zenod-ai/zenod/blob/main/docs/tester-invite-three-clear-promises-first.md. With my VPS1 root access, add one root-only wrapper that runs only the Zenod tester-code script with the arguments issue or status (scripts/stripe-testers.mjs in zenod-ai/zenod), allow the agent account to run just that wrapper, test that issue creates one code and nothing else can run, then append what you did to the E26-A1 line, commit and push." — unblocks: T1, E23-A1 invite — details: [first invite](http://vps3.taild81fbb.ts.net:8921/e26-t1/) — answer: APPROVED

## Non-Goals

- Claims that are not true of production today.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | Ticket worker | run_94349079-03e3-472e-a05c-d33608694772 (round 2 finish; round 2 build run_9ca8cb40) | E26-1, E26-2: the three promises on the tester page and the invite; round 2 (Jordi 2026-11-10 "you make a click and you go through the funnel"): one invite link with the code inside, sign-in, checkout with the code applied, a you're-in step | review (relaunch answered by the E26-S2 page, 2026-11-10) | none | [#1581](https://github.com/zenod-ai/zenod/pull/1581) merged ce1181e; [#1593](https://github.com/zenod-ai/zenod/pull/1593) merged ffa1659b; invite text 5559c414 | main | [full tester picture](http://vps3.taild81fbb.ts.net:8921/e26-s2/), [e26-s2](evidence/e26-s2-2026-11-10.md) (answers the relaunch: who creates invites, ten at once, Stripe yes, after checkout, today vs to build); earlier: [live funnel and screens](http://vps3.taild81fbb.ts.net:8921/e26-t1/), [e26-t1-r2](evidence/e26-t1-r2-2026-11-10.md); card docs/cards/E26-T1.md points to the same page | 2026-11-10T17:25Z | followups: start welcome email after checkout — Zenod has no sender today, a mail to testers is ask-tier; start lighter tester checkout — prefill their email and check if the billing address can go at €0; started E26-A2 (tester-code command, on Jordi's Mac list); followups: answered by E26-S2 (same page, its followups cover the mail key, code permission and welcome email); confirm: yes — Jordi opens the full tester picture and says if it closes the circle he asked for |
| E26-S1 | Ticket worker | unassigned | Tester funnel: a code, one link to sign up and pay, a welcome email: The invite ends in one link: the tester gets a code, picks an email, signs up and pays at checkout using the code (a Stripe coupon), then gets an email saying they are provisioned, with their WhatsApp number and next steps. | done (no confirm: same work as T1 round 2, which builds it) | none | none | main | none | 2026-11-10 | covered by T1 round 2 |
| E26-S2 | Ticket worker | run_7b98678e-34f4-4030-a2b3-3f44e0afdfd6 | Tester flow, live: public apply link, a one-time coupon by email: No hand-picked first tester: live with people from the internet. One public link: they apply with their email; each accepted applicant gets a one-time coupon issued only for them, by email, used at checkout. Draw the whole flow for Jordi on one page. | review | none | [#1597](https://github.com/zenod-ai/zenod/pull/1597) merged 0274bf2f | main | [full tester picture](http://vps3.taild81fbb.ts.net:8921/e26-s2/), [e26-s2](evidence/e26-s2-2026-11-10.md): one page, the full picture: one public link, the server accepts the first 10 itself (cap, stop switch, private list at cloud.zenod.dev/admin/testers), each acceptance creates a Stripe promotion code only for that person and emails the personal link; live on 0274bf2f (health 2026-11-10T17:24Z); form refuses non-emails live, admin and code queue 404 without auth; code making waits on a Stripe Promotion codes: Write tick or E26-A2; email waits on a Resend key (ask text on the page); welcome email to build; end-to-end test apply to checkout; infra-vps EPIC-2-A46 not needed for this flow; card docs/cards/E26-S2.md | 2026-11-10T17:25Z | followups: start mail key ask — invite and welcome emails need zenod-mt RESEND_API_KEY, ask text on the page; start code permission ask — one tick, Promotion codes: Write on the zenod-mt key, then ZENOD_TESTER_MINT=stripe, replaces E26-A2 for testers; start welcome email after checkout — same sender once the key lands; park sign-in with the applied email — needs the sender first; park earlier applications — applied under the hand-pick terms; confirm: yes — Jordi opens the page and says if this is the full picture he asked for |
| E26-S3 | Ticket worker | unassigned | Watch the first real outside sign-up end to end and record each step passed or fixed: €0 checkout with the code, WhatsApp pairing for a new account, Drive access for an outside Google account, the app signed in on production | ready | E26-S2 | none | main | none | 2026-11-10 | starts when the first stranger applies |
| E26-S4 | Ticket worker | run_8fe0bb21-396a-490e-a0fa-6a588368bc38 — claimed 2026-11-10T18:08Z, lease until 2026-11-10T20:08Z | Renew the Google Drive sign-in proof before it expires on 28 Nov (new checkouts close then), or raise the one ask to Jordi with the exact steps | active | none | none | main | none | 2026-11-10 | dispatched 2026-11-10 |
| E26-S5 | Ticket worker | unassigned | Tester month end without hands: the free month extends or ends by itself under a rule; the alert only for exceptions | ready | E26-S2 | none | main | none | 2026-11-10 | after E26-S2 |
| E26-S6 | Ticket worker | unassigned | From tester to paying: the end-of-test offer (what the tester sees, one click to the €9 Hosted checkout) and one live €9 journey recorded (with ZAL-A5) | draft | E26-S5 | none | main | none | 2026-11-10 | after the first testers; the live payment needs Jordi (ZAL-A5) |
| E26-S7 | Ticket worker | run_3c01dcde-de5f-47f7-9e3b-a5f57dd3ffb8 — claimed 2026-11-10T18:08Z, lease until 2026-11-10T20:08Z | Daily counts anyone can read, no names: applications, accepted, signed up, active testers, paying customers | active | E26-S2 | none | main | none | 2026-11-10 | dispatched 2026-11-10 |
| E26-S8 | Ticket worker | unassigned | Capture never stops for AI credit: an alert reaches HQ days before the DeepSeek or OpenRouter balance runs out, and who tops up is named | ready | none | none | main | none | 2026-11-10 | with E26-S7 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | epic “Tester invite: three clear promises, first invite out” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-10 03:54Z Zenod: Log/2026-11-10.md#^e-ecf0b8 I think there is this diagram in ") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | Planned from Jordi's voice note (WhatsApp 2026-11-10 03:54Z, Zenod Log 2026-11-10 ^e-ecf0b8); ready on his ask (L-37); works with EPIC-23 ask E23-A1 (he names the first tester) | T1 makes the page and invite plain and ready; sending stays his | his voice note | when T1 is in review |
| 2026-11-10 | accepted | E26-S1 ready on Jordi's ask (L-37, Team desk: "📎 Also in this note (vn_c837c0f6): workflow for the campaign; user registration with a code; single link for authentica") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | E26-S2 ready on Jordi's ask (L-37, Team desk: "📎 Also in this note (vn_8bd5796f): Clarify the flow for testers; Change to live testing with internet users; Issue one-") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | revised | Jordi relaunched T1 (vn_d263e8de): "we're a little bit in circles on this. Can you kind of close the circle for me?... who creates the invite?... are they going through Stripe? Yes or no?... Paint the full picture" | answered by one page from E26-S2 (in flight, run_7b98678e): invites created automatically on acceptance, batches without hand work, Stripe promotion code per person and Stripe checkout, exists vs to build; T1 returns to review pointing at that page, no second build | his voice note | when E26-S2 reports |
| 2026-11-10 | accepted | zenod-social mapped the whole tester and paying journey against Jordi's words (EpicTeam desk, 10 Nov): "by the end of the month, we need to be live on all of this product ... complete the journey and have these kind of flywheels ... unattended ongoing businesses"; seven gaps handed to Zenod | gap 1 is E26-S2 (built); new rows E26-S3 (first sign-up watched), S4 (Drive proof before 28 Nov), S5 (month end by rule), S6 (tester to paying, draft), S7 (daily counts), S8 (credit alerts) | desk note 2026-11-10-zenod-social-live-by-30-nov-seven-product-gaps | 2026-11-30 |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
