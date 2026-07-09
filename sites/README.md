# sites/ — Atomic Suite website skeletons (Iteration 0)

Static one-pagers, one per buildable unit of the Atomic Suite (EPIC 2.5). Each is a
self-contained `index.html`: no external CDNs, inline CSS, responsive, emoji favicon.

Per **RD-4 DECIDED**: sites and names launch independently NOW, all pointing at the
monorepo `zenod-ai/zenod`. These are **skeletons** — content may lag the units they
describe. Each page names the unit and its one-sentence job from the catalog in
`docs/EPIC-2.5-ATOMIC-UNITS.md`, in the "one door / one number" house style.

## Pages

| Path | Unit | Job (one line) |
|---|---|---|
| `ring/` | The Ring | one door — owns your conversation, routes, relays verbatim (Phylax = its gateway) |
| `zenod/` | Zenod | memory owner — evidence in, meaning out, every fact cited |
| `archus/` | Archus | backlog owner — one home per ticket |
| `epaminon/` | Epaminon | cloud MCP worker — prompt + effort in, GitHub artifacts out |
| `callisthenes/` | Callisthenes | outbound voice — only holder of the sending keys, throttled |

## Deliberately absent

- **The Council guy** — page **BLOCKED pending RD-2** (his name is UNDECIDED;
  recommendation is "Mentor"). Do not create his page until RD-2 is DECIDED.
- **Herald** — **Epic 3, not this epic.** Skipped here on purpose.
- **Phylax** — not its own page: per RD-1 DECIDED, Phylax is the channel gateway
  *inside* the Ring and sells as part of it. It is featured on the Ring page, not
  given its own site.

## Notes

- Tone borrows from the existing `apps/site` (serif display + sans body, warm paper
  palette); these skeletons are kept dead-simple and self-contained and do **not**
  depend on or modify `apps/site`.
- Iteration-0 scope: skeleton only. No build step, no framework — open `index.html`.
