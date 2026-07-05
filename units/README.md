# `units/` — the Atomic Suite, one folder per unit

Owner of this file: **W-F** (EPIC 2.5 Iteration 0). Parent doc:
[../docs/EPIC-2.5-ATOMIC-UNITS.md](../docs/EPIC-2.5-ATOMIC-UNITS.md) · split memo:
[../docs/EPIC-2.5-REPO-SPLIT-MEMO.md](../docs/EPIC-2.5-REPO-SPLIT-MEMO.md).

## What this directory is

Per RD-4 (DECIDED 2026-07-05, staged): **the suite stays in this monorepo now**, but the folder
tree is restructured so that **each unit lives in exactly one top-level folder** with its own
Dockerfile / compose / build. The eventual repo split (one repo + one website per unit, per law 8)
then becomes a mechanical **`git filter-repo`** per folder — *not* a code refactor.

> **The whole point:** when the RD-4 split trigger fires (SEAM-SPEC v1 passes the tester on ≥2
> units without spec edits), splitting a unit out is `git filter-repo --path units/<unit>` into a
> fresh repo. If the carve is clean, nothing else changes: the unit already builds from its folder
> alone and talks to its peers over the seam. If we have to *move code around* at split time, we
> did the restructure wrong.

## Target layout (one folder per unit)

```
units/
  README.md            ← this file (W-F)
  ring/                ← ring-core + Phylax gateway compose (W-A)
  phylax/              ← WhatsApp/Telegram channel gateway (own container; may nest under ring/) (W-A)
  <council-guy>/       ← the chief-of-staff guy; name = RD-2 (Mentor, pending) (W-B)
  zenod/               ← memory unit (W-C)
  archus/              ← backlog unit
  epaminon/            ← execution unit
  callisthenes/        ← outbound/voice unit (today: AGENT=outbound + services/x-mcp + services/reddit-mcp)
shared/                ← the ONE published shared library (today: packages/core, workspace `zenod`)
```

Each `units/<unit>/` folder MUST, at the split trigger, contain:

- **`Dockerfile`** — builds this unit's image from this folder + the published shared lib ONLY.
  Nothing else in the monorepo is a build input.
- **`docker-compose.<unit>.yml`** — how it deploys (a unit MAY be a small compose, e.g. the Ring =
  ring-core + Phylax; it still sells as one atomic thing — vision §THE VISION).
- **`package.json`** — depends on the shared lib by its **published version**, never a workspace
  `file:` path or a `../` relative import into another unit.
- **`README.md`** — a stranger's quickstart: the MCP endpoint, the bearer token, the one repo/key
  it owns. No suite-internal types (SEAM-SPEC item 16).
- unit-owned source, tests, and config.

## The invariants that make the split a `filter-repo`, not a refactor

1. **No cross-unit source imports.** A file under `units/A/` never imports from `units/B/`. Units
   compose only over the **seam** (pure MCP over streamable HTTP — `peerClient.ts` already does
   exactly this; SEAM-SPEC §1). Peer calls are HTTP, not `import`.
2. **The only shared code is the published shared lib** (`shared/`, today `packages/core` /
   workspace `zenod`). It is imported by version, published to the registry, and contains **zero
   unit-specific logic** — it is the generic engine + vault + types + git primitives, nothing that
   knows about WhatsApp, backlog, outbound, or notifications. (Today it does NOT yet meet this bar —
   see the memo's core-purity blocker.)
3. **Each unit's image builds from its folder alone.** `docker build units/<unit>` (plus the
   published shared lib) succeeds with no other monorepo path in the build context. This is the
   W-F acceptance test the tester runs from a fresh clone.
4. **The seam is the only coupling.** If removing a unit's folder breaks another unit's *build*
   (not its runtime seam call), that's a leak — file a removal ticket (memo §per-unit audit).

## Why we did NOT physically move the fused code yet (staging discipline)

The live Console is today **one image** (`Dockerfile` at repo root) that runs as any unit via the
`AGENT` env var (`packages/server/src/agent.ts` → `resolveAgent`). All unit tool-sets are compiled
into the single `@zenod/server` package and gated at **runtime** by boolean flags
(`vaultless`/`backlog`/`executor`/`outbound`/`notifier` in `runtime.ts`), not at build time.

Carving `packages/server/src/*` into `units/*/` blind would break that live image on the next
deploy. So W-F delivers the **skeleton + the audit + the staged plan**; the physical carve of each
unit's code into its folder is owned by that unit's lane (W-A/W-B/W-C) and gated behind the split
trigger. This folder is the target; the memo is the map from here to there.

See [../docs/EPIC-2.5-REPO-SPLIT-MEMO.md](../docs/EPIC-2.5-REPO-SPLIT-MEMO.md) for the per-unit
build-independence verdicts, the named blocking cross-imports, and the dated split gates.
