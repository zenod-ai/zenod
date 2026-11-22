# Daily tester picture (EPIC-7 E7-S17) and tester table (E7-S27)

**E7-S27 (Jordi, vn_40b9ff8f, 22 Nov): "rows, and each row is a tester, and each column is like a sign up, Google Drive set up,
GitHub set up, one memory created, one voice note sent ... each tester having a color ... welcome WhatsApp sent."** The picture
is now exactly that table: one row per tester (sign-up date and the last 4 of the account key, never an email), seven columns
(signed up, Google Drive, GitHub, WhatsApp linked, one memory, one voice note, welcome WhatsApp sent), each cell green or grey,
one headline, and one line on whether we hold their phone numbers (only Phylax holds a linked tester's number; nothing here shows
it). The same run rebuilds a calm page on the page host, `http://vps3.taild81fbb.ts.net:9008/` (`zenod-tester-table-page.service`,
`page_server.py`, folder `/var/lib/vps3-scratch/t3agent/pages/e7-s27`, `PAGE_DIR` in picture.py). Grey also covers a cell the
running release cannot read yet (voice note and welcome need the E7-S27 production release); the footer names those columns.
The JSON is `zenod-tester-picture/v2`: the v1 fields plus `columns`, `column_counts`, `unread_cells`, `phone_line`, `page_url` and
per tester `label` and `cells` (seven true/false values).


Jordi, vn_b73d7c41 (20 Nov): how many testers, how many logged in, how many fully set up by his four steps (vault: GitHub or
Google Drive; WhatsApp linked; at least one WhatsApp note; at least one memory), where each is stuck, and "right now I'm lost".

`zenod-tester-picture.timer` (vps3 user timer, 11:30 UTC = 05:30 Mexico City, 30 min before his 06:00 briefing) runs
`picture.py`, which reads production through VPS1 (the ops token never leaves it) and writes, under
`~/.local/state/zenod-tester-picture/`:

| File | What |
|---|---|
| `latest.png`, `latest.json` | today's picture and facts (copies of the day's files) for whoever sends them |
| `<Mexico City day>/tester-picture.png`, `.json` | the same, kept per day |

## JSON (`zenod-tester-picture/v1`)

`punchline` (one line, say it first), `caveat` (a step production cannot be read for yet, else null), `signed_up`, `applied`,
`logged_in_24h`, `fully_set_up`, `step_counts`, `notes_24h`, `saves_24h`, `stuck_by_step`, `owner`, `png` (path of the
picture or null), and `testers[]`: `tester` (`…` + last 4 of the account id), `steps` (`vault`, `whatsapp`, `message`,
`memory`: true, false or null = unknown), `fully_set_up`, `logged_in_24h`, `stuck_at` (the first false step), `stuck_text`,
`detail`, `owner`, `next`, `our_bug`, `notes_24h`, `saves_24h`. No email, number, code or note text, ever.

## Sources (read only)

- `GET /api/ops/testers/progress` on production (ops token, `packages/server/src/testerProgress.ts`): per real tester (our own
  test accounts left out, one person with two accounts counted once) the vault state from the account, the WhatsApp step,
  WhatsApp notes and finished memories (all time and last 24 h) from the tenant's task ledger, and the last time they used
  the app. The last-seen record is a small file (`tester-last-seen.json`) written at most once per person per 5 minutes; it
  starts when this release goes live, so "logged in" shows `?` for the first day.
- Before that release is live the script falls back to `whatsapp-setup` plus `tester-watch --json --redact`: WhatsApp and
  memories are read, the vault and logins show `?` and the caveat says so. A step is never guessed.
- `GET /api/public/counts` for how many applied.

`python3 scripts/tester-picture/picture.py --dry-run` prints the punchline and the JSON and writes nothing; tests:
`python3 scripts/tester-picture/picture.test.py`. Install the timer: `bash scripts/tester-picture/install.sh`.
