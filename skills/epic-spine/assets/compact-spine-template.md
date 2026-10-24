# EPIC-<n>: <name>

Spine profile: compact
Repository: <owner/repo>
Primary document: <path to this file>
Spine ID: <stable-id>
Root spine: [<root title>](<path to the root spine>)
Parent spine: [<parent title>](<path to the parent spine>)
Additional root rationale: n/a
Integration branch: main
<!-- Optional headers: `Integration policy: main-direct` (default) or `pr-approval` (a deploy-triggering path is gated with `Deploy gate:` next to `Deployed from:`, not the whole repo; ../references/git-doctrine.md); `Dispatch profile: default` (../references/roles-and-dispatch.md); `Ticket backend: github|local`; `Spine dialect: v1|v2`. Create the file with `scripts/spine_new.py`, which writes this shape. -->

## Goal

<what the work achieves and why, in plain words; if the why is not written anywhere in the repo, ask the owner>

## Serves

[<parent title>](<path to the parent spine>): <one sentence: how this serves its parent>

## Done means
<!-- Machine-read contract (`- [ ] <ID> <outcome>` lines here, Status/Waiting on, Issue Ledger columns): ../references/spine-model.md. -->

- [ ] X-1 <observable outcome and the evidence that shows it>
- [ ] X-2 <a second outcome (2-5 in all), or delete this line>

## Current State

Owner: <one active steward>
Status: ready
Last attempted: <last concrete action>
Result: <actual result>
Evidence: <source or evidence link>
Waiting on: none
Approved work: <bounded authorized work>
Next action: <one exact action>
Source revision: <verified source commit or content hash>
Verified at: <absolute time with timezone>

## Non-Goals

<explicit scope exclusions>

## Operating Learnings

Optional. One line per learning: `L-<n> | applies when | the rule, imperative | why (≤ 8 words) | confirmed YYYY-MM-DD`. Keep only what applies to this spine; scoped entries point to the branch spine that owns them. Root spines also keep an **Always** list (≤ 12 lines) and a **Scoped index**. See ../references/learnings.md.

- L-1 | <applies when> | <imperative rule> | <why, ≤ 8 words> | confirmed YYYY-MM-DD

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | <assignment> | <one task> | draft | none | <branch> | <base> | <evidence> | <time> | <next action> |

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| <date> | accepted | <choice> | <reason> | <evidence> | <condition> |

<!-- Optional: Phase in Current State; `## Outcome` written at close (../references/spine-model.md); hierarchy fields and Spine Map when connected;
Human Gates, Write Scope, Recovery And Takeover, or Book binding when applicable.
Use one canonical Waiting on value for blockers/waits; state 'none' explicitly.
Completed handoffs belong in linked history; never add a competing live cursor. -->
