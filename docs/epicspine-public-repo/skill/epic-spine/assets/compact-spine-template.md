# EPIC: <name>

Spine profile: compact
Ticket backend: github
Spine dialect: v1
Repository: <owner/repo>
Primary document: <path to this file>
Spine ID: <stable-id>
Integration branch: main
Integration policy: main-direct
<!-- Optional: main-direct (default) or pr-approval. The delivery manager merges verified work to the integration branch itself under ../references/git-doctrine.md. -->
Dispatch profile: default
<!-- Optional: overrides merge field by field over the built-in default; `template:<name>` is reserved and not yet defined. See ../references/roles-and-dispatch.md. -->

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

## Mission

<one desired outcome>

## Non-Goals

<explicit scope exclusions>

## Operating Learnings

Optional. One line per learning: `L-<n> | applies when | the rule, imperative | why (≤ 8 words) | confirmed YYYY-MM-DD`. Keep only what applies to this spine; scoped entries point to the branch spine that owns them. Root spines also keep an **Always** list (≤ 12 lines) and a **Scoped index**. See ../references/learnings.md.

- L-1 | <applies when> | <imperative rule> | <why, ≤ 8 words> | confirmed YYYY-MM-DD

## Definition Of Done

- [ ] <observable acceptance and evidence required>

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | <assignment> | <one task> | draft | none | <branch> | <base> | <evidence> | <time> | <next action> |

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| <date> | accepted | <choice> | <reason> | <evidence> | <condition> |

<!-- Optional: Phase in Current State; hierarchy fields and Spine Map when connected;
Human Gates, Write Scope, Recovery And Takeover, or Book binding when applicable.
Use one canonical Waiting on value for blockers/waits; state 'none' explicitly.
Completed handoffs belong in linked history; never add a competing live cursor. -->
