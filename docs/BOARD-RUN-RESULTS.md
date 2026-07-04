# BOARD RUN — Results (C-01…C-22)

Run date: 2026-07-04
Tester: Cowork agent driving the Console **chat lane** (`chat_with_console`) + typed backlog tools + execution
polls. Authority: `docs/BOARD-RUN.md` / `docs/CANONICAL-TESTS.md`.

## ⚠️ Honest scope boundary (read first)
I can hard-test the chat-observable behaviours (outbound, execution dispatch/verify, memory, typed interface).
I **cannot** perform the ops/git steps from here, so those rows are marked *unverified-by-me*, not passed:
verifying the deployed VPS SHA (0.1), confirming a ping lands on Jordi's physical phone (0.2 / C-08), the
banked live-fire re-fires (C-16/C-17/C-21), and — critically — **opening & self-merging a PR to
`zenod-ai/zenod` (C-20/D3)** and flipping LAUNCH-CONTROL. So this run **cannot** close Epic 1 even if every
chat row were green; the close requires the worker/ops path.

## Verdict: ❌ THE BOARD BLED — not 22/22. Do NOT close Epic 1.

Confirmed reds: **C-07, C-19, C-15**. Each mapped to exactly one ticket (below). Per the runbook: stop, score,
hand the pen back for one fix batch.

---

## Scoreboard

| Test | Verdict | Receipt |
|------|---------|---------|
| 0.1 Deployed SHA = `6559e87`+ | ⛔ unverified-by-me | Can't read the VPS container SHA from chat |
| 0.2 Phylax ping → phone | ⛔ unverified-by-me | Can't confirm delivery to Jordi's device |
| **C-22** drafts never send | ✅ PASS | 2 drafts, both `toolEvents:0`, approve affordance |
| **C-02** natural approval posts | ✅ PASS | "Tweet approved" → `…220338335256804` |
| **C-03** nothing pending | ✅ PASS | bare "approved" → "Nothing pending to approve." |
| **C-01** explicit send | ✅ PASS | "Tweet this … post now" → `…220396136944059` |
| **C-04** image tweet | ✅ PASS | one post, `…220631542255808` (image visible unverified) |
| **C-05** blocked-send UX | ✅ PASS | "looks good" → friendly "Acknowledged", no raw ERROR, no post |
| **C-06** issue-create e2e | 🟥 RED | router first mis-routed to life backlog; reply self-contradictory ("nothing filed" + "created+ran"); worker `…129370286` still running (went into code work), issue URL unconfirmed |
| **C-08** traceable from first ping | 🟡 partial | dispatch replies carried execution IDs; phone-side ping resolution unverified-by-me |
| **C-07** done requires evidence | 🟥 **FAIL** | echo runs stating "no deliverable expected" (`…129324096`, `…129334945`) → verifier marked **"failed — nothing verifiable"** (should be "completed, no deliverable expected"). **→ #255** |
| **C-09** long-run heartbeat | 🟡 partial | mid-run `execution_status` showed live `phase`/`progressNote`/`recentEvents`; unprompted >10-min WhatsApp heartbeat = banked/unverified |
| **C-10** quota fallback | ✅ PASS | echo ran on **claude-sonnet-5**, "Status: complete", zero vendor noise |
| **C-16** config canary | ⛔ banked | cite zenod#487; not re-verified by me |
| **C-17** budget kill | ⛔ banked | cite `ephemeral-1783126896084`; not re-verified by me |
| **C-21** durable resume | ⛔ banked | cite `ephemeral-1783125188617`; not re-verified by me |
| **C-13** store→recall→receipt | 🟡 partial | recall returned ZENITH-4471 + resolving anchor `Projects/Zenod.md ^e-2864e6` (commit `0f49434`) — but the filing-complete receipt never reached chat (#236), and the fact was woven into a project page (meaning-drift) |
| **C-11** never assert empty world | ✅ PASS | grounded in real PRs #498/#499/#501, #247/#249; no "no work ran" (carried a spurious "⚠️ Correction" prefix — see C-15) |
| **C-12** status counts its own sends | ⛔ not-run | not conclusively exercised this board (needs multi-task+send+status) |
| **C-14** day recall w/ artifacts | ✅ PASS | grounded, cited links, no fabrication, no correction prefix |
| **C-18** typed receipt-or-error | ✅ PASS | `backlog_create` #253 + #254 (both `verified:true` ID+URL), back-to-back both landed; `backlog_close` #254 verified |
| **C-19** no magic words | 🟥 **FAIL** | "jot a note on #253 …" **blocked ×3** ("mutating peer tools require an explicit write/run/send instruction") + contradictory correction prefix. **→ #256** |
| **C-20** green PRs self-merge | ⛔ unverified-by-me | Cannot open/merge a PR to zenod-ai/zenod from the chat lane |
| **C-15** zero fabrication (whole run) | 🟥 **FAIL/risk** | recurring contradictory/spurious "⚠️ Correction — no GitHub issue was created … ignore claim below" prefix (C-11, C-19) + B1 unreceipted "created+ran". **→ #257** |

**Clean chat passes:** C-01, C-02, C-03, C-04, C-05, C-10, C-11, C-14, C-18, C-22 (10).
**Reds:** C-07, C-19, C-15. **Partial/incomplete:** C-06, C-08, C-09, C-13, C-12.
**Unverified-by-me (ops/banked):** 0.1, 0.2, C-16, C-17, C-21, C-20.

## Fix batch (one ticket per red — hand the pen back)
- **#255** — C-07: no-deliverable/echo runs must render "completed (no deliverable expected)", not "failed".
- **#256** — C-19: route paraphrased backlog edits/comments to the typed deterministic tools; never block for a
  missing keyword.
- **#257** — C-15: kill the spurious "⚠️ Correction — no GitHub issue was created" prefix on turns that didn't
  attempt an issue creation, and stop dispatch replies claiming "created+ran" before an issue-URL receipt.

(Note: C-06's router mis-route and C-13's missing proactive filing receipt (#236) are adjacent to #257/#236 —
fold in during the fix batch or file separately if you prefer one-defect-per-ticket.)

## Do NOT close
`docs/LAUNCH-CONTROL.md` / Epic 1 stay OPEN. The board is not 22/22, and the close path (C-20 self-merge +
LAUNCH-CONTROL flip + canonical-doc PR) isn't executable from the chat lane regardless. One fix batch →
redeploy → re-run.

## Housekeeping (nothing deleted, per Jordi)
Real tweets posted this run (5): `…220338335256804` (C-02), `…220396136944059` (C-01),
`…220631542255808` (C-04 image), plus the two drafts that were later approved are among these.
Issues created: `#253` (C-18 canary A, open), `#254` (C-18 canary B, closed), `#255`/`#256`/`#257` (fix-batch
tickets). Runs dispatched: `…129324096`, `…129334945` (echoes, marked failed — see C-07), `…129370286`
(C-06 issue-create, still running). Memory: `Projects/Zenod.md` updated with the canary fact (commit `0f49434`).
