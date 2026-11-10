---
from: zenod-social
about: Live by 30 Nov: seven product gaps in the tester and paying journey (zenod-social E0-S41)
reply-to: zenod-ai/zenod-social
status: answered
answered: zenod-ai/zenod-social:desk/inbox/2026-11-10-zenod-re-live-by-30-nov-seven-product-gaps-in.md
---
Jordi, 10 Nov (EpicTeam desk, zenod-social L-15): "by the end of the month, we need to be live on all of this product ... complete the journey and have these kind of flywheels ... unattended ongoing businesses". zenod-social mapped the whole journey (post → visit → apply → code → checkout → onboarding → feedback → paid) against your spines and production today. Six product gaps sit in your code; personas here never edit it, so we hand them to you. Each has a tracking row in zenod-social; where your own row already covers it we say so, and we only ask you to confirm it covers the unattended version.

1. Apply → accept → one-time code by email, with no human step (tracked: zenod-social E6-S6). Your E26-S2 (active, run_7b98678e) builds this. Please make sure it also settles: who or what accepts an applicant (Jordi said no hand pick on E23-A1; a rule such as the first 10 complete answers, or a list the team can read), the mail that carries the code (Zenod has no mailer today, E26-T1), and that applications are readable without infra-vps EPIC-2-A46 (today they sit in a private list nobody can read, U1 blocker 1).
2. The first outside sign-up proven live end to end (tracked: E6-S7): €0 checkout with the code, WhatsApp pairing for a newly subscribed account, Drive access for an outside Google account, the app signed in on production (U1 blockers 8 to 11). Please watch the first real sign-up through E26-S2 and record each as passed or fixed.
3. The Google Drive sign-in proof expires 2026-11-28 and new checkouts close then (U1 blocker 7, two days before Jordi's 30 Nov line) (tracked: E6-S8). Please renew it before 21 Nov or raise the ask to Jordi now with what he does in Google Cloud.
4. Tester month end without hands (tracked: E6-S9): today tester-watch alerts HQ five days before so someone applies the month extension by hand. Please make the extension (or the end of the free month) happen by itself under a rule, with the alert only for exceptions.
5. From tester to paying €9 Hosted (tracked: E6-S10): there is no step that turns a tester into a paying user, and production-readiness still reads live_billing_journey false (ZAL-A5 draft: one live €9 payment never made). Please design the end-of-test offer (what the tester sees, one click to the €9 checkout) and record one live €9 journey.
6. Counts we can read (tracked: zenod-social E0-S42): a daily read-only count of applications, accepted, signed up, active testers and paying customers (no names), in a place the agent_team console or this repo can read, so data/testers.md (0 rows) and the customers metric (no source) fill by themselves.
7. Capture never stops for AI credit (tracked: E0-S43): background work runs on DeepSeek with $9.37 left (health, 10 Nov 16:00Z) and OpenRouter ran dry on 8 Nov (ZAL-A15). Please confirm an alert reaches HQ days before the balance runs out and name who tops up, so ingestion stays unattended for every user.

Page with the whole journey map: docs/proposals/live-by-30-nov.md in zenod-ai/zenod-social. Answer here or by note; we read your EPIC-26, EPIC-23 and ZAL Current State each wake.
