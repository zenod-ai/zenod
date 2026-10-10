# Shortlists

Default behavior when a shortlist (a selection of candidates) is the key
deliverable of a task, ticket, or spine mission.

## When it applies

"Find / choose X": stays, flights, places, vendors, properties, candidates,
tools. Also when a mission or ticket asks for a shortlist. Not for every task
that merely mentions options, and not a replacement for ordinary code/docs work.

## What to produce

- **JSON source of truth** at `shortlists/<slug>.json`; never hand-edit the HTML.
- **Generated page**: `python3 -B <skill>/scripts/build_shortlist.py shortlists/<slug>.json shortlists/<slug>.html`.
  Regenerate after every JSON change.
- **Serve it** per `references/artifacts.md`: 127.0.0.1 only, verified HTTP 200,
  then hand the user the clickable URL.
- **Record choices and rejections** (below).

## Schema

Top-level required: `title` (string); `criteria` (non-empty string[]); `items`
(non-empty object[]).
Top-level optional: `subtitle`, `generatedAt` (ISO), `lane` (free label, e.g.
`stays`, `vendors`), `trip` (context slug), `columns` (string[]), `notes` (string[]).

Item required: `id` (stable, unique within the file); `name`.
Item optional: `url`, `area`, `score` (0–10, default sort), `price`
(`{amount, currency, unit}`), `rating`, `reviewCount`, `tags` (string[]),
`evidence` (`{type, url, quote}[]`), `risks` (string[]), `notes`, `status`,
`starred` (boolean), `rejectedReason`.

`columns` defaults to `score, area, price, rating, tags, evidence, risks,
status`. A key not in that set renders the matching item value as escaped text,
so extra per-repo fields (e.g. a contact state) need no builder change; list
them in `columns` to show them.

## Status vocabulary

Fixed set; extend this list additively rather than inventing values:

| Status | Meaning |
|---|---|
| `candidate` | Found, not yet judged. Default when `status` is omitted. |
| `shortlisted` | Passes the criteria; on the shortlist for review. |
| `contacted` | Outbound action taken (message, enquiry, booking request). |
| `chosen` | Selected. |
| `rejected` | Excluded; `rejectedReason` is required and shown on the row. |

## Decision history

Choices are never silent:

1. Set `status` to `chosen`/`rejected` in the JSON and rebuild the HTML.
2. For `rejected`, fill `rejectedReason`.
3. Add one dated row to the bound spine's Decisions table.
4. Keep rejected rows in the JSON forever (hidden only by the status filter) so
   future searches do not resurface them.

## Definition of done

- Valid schema (the builder exits non-zero with a clear error otherwise).
- Evidence and risks on each row; `criteria` states the yardstick.
- HTML generated, never hand-edited, served on `http://127.0.0.1:<port>/...`
  with a verified 200, and the link handed to the user.
- Choices recorded in the bound spine's Decisions.

## Ticket flow

A worker builds JSON + HTML + tests in its worktree and returns `url`, `port`,
`pid`, and `directory`; the manager serves it and reports the URL. Commit the
JSON source; regenerate the HTML when serving rather than hand-editing it.

Adapted from a proven selection workflow; app-specific logic (maps, guided
badges, external contact ledgers) is deliberately left out.
