# Librarian Doctrine

How the librarian organizes the vault, distilled from community evidence (Reddit, HN, Obsidian forum, practitioner repos, 2024–2026; researched 2026-06-10) plus Karpathy's llm-wiki pattern. Companion to [M0-SPEC.md](M0-SPEC.md) — these are the rules the engine enforces in code.

## The reference point (Karpathy, primary sources verified 2026-06-10)

Karpathy's ["LLM Knowledge Bases" post](https://x.com/karpathy/status/2039805659525644595) (April 2026) and the companion [llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (2026-04-04) ignited the current wave. Verified verbatim from the gist:

- *"Instead of just retrieving from raw documents at query time, the LLM incrementally builds and maintains a persistent wiki."*
- Raw sources *"are immutable — the LLM reads from them but never modifies them."*
- The wiki is *"a directory of LLM-generated markdown files… The LLM owns this layer entirely,"* with a schema file *"(e.g. CLAUDE.md for Claude Code)"* read first.
- *"You're in charge of sourcing, exploration, and asking the right questions. The LLM does all the grunt work."*

His [Farzapedia endorsement](https://x.com/karpathy/status/2040572272944324650) explicitly prefers an **explicit, inspectable markdown memory artifact** over the *"status quo of an AI that allegedly gets better the more you use it"* — i.e., markdown-vault memory over opaque DB memory. Supporting frame: his [LLM OS](https://x.com/karpathy/status/1723140519554105733) (context window = RAM, filesystem = long-term memory).

Zenod is this pattern delivered as a service instead of a manual workflow: filing discipline as code, not willpower.

## Core principle (community consensus)

> **"Procedural code owns the environment. The agent owns content."** (obsidian-mind)
> **"The LLM is the librarian. You're the curator."** (second-brain)

Schema enforcement must be deterministic (validation code, not prompts). The methodology brand (PARA, Zettelkasten, Johnny Decimal) matters less than: sparse predictable structure + machine-readable indexes + a schema doc at root.

## Failure modes we are built to prevent

Documented across practitioner reports:

- **Duplicates** created months apart; same-filename link collisions silently resolving wrong.
- **Tag sprawl** when the agent free-invents taxonomy (duplicate tags, single-use tags).
- **Orphan notes** — "a note without links is a bug" (obsidian-mind).
- **Vault pollution / AI slop** — the deepest objection (Späti, "Keep AI Out of Your Vault"): over time you can't tell your thoughts from generated filler.

Anti-slop answer: **provenance is first-class.** Human-authored vs agent-written is always distinguishable — the git contract gives this for free (commit author identity + per-fact capture links). Agents never edit human-authored thinking notes.

## Vault rules (the meta-schema, fixed in code)

1. **Two tiers.** Immutable captures (`Inbox/`, `Log/`, `_attachments/` — append-only, never edited, source-linked) and distilled pages (`Areas/`, `Projects/`, `Notes/` — entity-centric, regenerable, every claim citing its captures).
2. **Shallow purpose folders only.** Folders are coarse routing; deep hierarchy fails agents.
3. **Links over folders.** Every distilled page links to related pages (or the `Tree`); orphans fail validation. Each page also names its `parent` in the memory tree (below).
4. **Minimal enforced frontmatter**: title, type, tags (controlled vocabulary), created, updated, summary. New/rewritten pages also carry OKF-compatible `description` and `timestamp` aliases. Enables cheap two-pass retrieval: scan titles/tags/summaries first, open bodies only when needed.
5. **Schema doc at root** (AGENTS.md) — the agent reads it first; validation code enforces it regardless.
6. **Meta-schema fixed; taxonomy evolves by proposal.** Folder set, frontmatter keys, naming, linking rules change only via versioned migrations. Tags/MOCs evolve through explicit, logged proposals. Zenod is a strict OKF profile: OKF compatibility is an interoperability layer, not permission to weaken Zenod lint.
7. **Entity pages are the primary write target.** Distillation lands on interlinked entity/topic pages, not a journal — the Log stays as a raw source, so knowledge compounds instead of accumulating.
8. **Write distilled pages for LLM readers**: dense, self-contained, explicit links — a page must survive being dropped cold into a context window with no implicit shared context.

## Memory tree (EPIC-9, schema v1)

Pages hang in a tree so that a memory's path from the root *is* its context ([E9-1 audit](epic9/E9-1-memory-structure-audit.md) §4–§5). Code: `packages/core/src/vault/tree.ts` (schema, parsing, lineage), `treeLint.ts` (lint), `treeSeed.ts` (seed).

- **Level 0** is fixed: two groups, **working memory** (ongoing now: a plan, a decision in progress) and **long-term memory** (durable facts, preferences, runbooks, finished things). The Log is the evidence underneath, not a branch.
- **Level 1** is the vault-root `Tree.md`: one line per root node under a `## Working memory` or `## Long-term memory` heading, in the form
  `- <name> | working|long-term | [[<page path without .md>]] | <one-line summary>`.
  Tree.md never holds deeper levels; nested bullets fail lint.
- **Page frontmatter** carries the rest of the tree:
  - `parent:` a wikilink or vault path to the parent page (`"[[Hair transplant]]"`, `"[[Areas/Life admin]]"`; quote it in YAML). A level-1 root page carries `parent: "[[Tree]]"`.
  - `memory: working | long-term`. Required on root pages and equal to their Tree.md group; optional below, and when present it must match the root the page hangs under (a page inherits its root's group, so closing a working root and moving it under a long-term node needs no rewrite of its children).
  - `provisional: true` (optional) marks a node created because nothing fitted (filing rule 4); the sweep reviews it.
- **Scope.** Every meaning page (`Areas/`, `Projects/`, `Notes/`, minus index pages) is placed. Log entries, Inbox files and `_attachments/` are not tree pages.
- **Lint (`zenod tree lint`, `lintTree()`).** Errors: Tree.md missing or malformed; a node whose page is missing, or whose page lacks `parent: "[[Tree]]"` and the matching `memory:`; a page without `parent`, with a parent that does not resolve to a meaning page, or with `parent: "[[Tree]]"` but not listed in Tree.md; a cycle; a page deeper than level 6; a `memory:` that disagrees with its root. A page below a broken ancestor is not reported twice. Duplicate titles are warnings. The report also counts Inbox machine files (needs-filing stubs, receipts) and markdown outside the schema folders.
- **Lineage (`buildTreeIndex().lineage(path)`)** returns the steps root → leaf and the group; `formatLineage` renders `Working › Hair transplant › 2023 Barcelona quotes`. `children(path)` lists a node's direct children. Retrieval (E9-3a), the librarian (E9-2b) and the sweep (E9-2d) use these, not their own parsing.
- **Seed (`zenod tree seed`).** Prints the audit's proposed Tree.md, or with `--out <dir>` writes Tree.md plus one lint-clean root page per node into an empty directory. It never overwrites; moving an existing vault into the tree is a reviewed migration (E9-2c), not a seed.
- **Filing into the tree (E9-2b, `packages/core/src/engine/treePlacement.ts`).** Every capture still lands in the daily Log first. Once the librarian has filed it:
  - *Placement (rules 2–4, only when the vault has a `Tree.md`).* A page the filing wrote that has no resolvable lineage gets `parent:` set to the best-matching node. Matching walks down from the roots, scoring token overlap with node names (×2) and summaries. A deeper page wins only when its own name matches, so leaves do not chain under siblings, and provisional pages never adopt others. A weak match also sets `provisional: true`. A capture that reached no page (an Inbox question, an uncertain topic, or a classified capture where nothing fitted) becomes a provisional leaf in `Notes/` under the closest node, quoting the capture and citing its entry. The touched pages must pass `lintTree()` and `zenod lint`, otherwise the placement is undone and only a plain `filed:` line is written.
  - *Root-only filings reach the leaf (E9-2f).* When a filing (not an ops rollup) reached only level-1 roots, the deepest page below each root that matches it also gets the capture as a line in its `## Captures` section: `- 2026-10-23 · <one-line summary> [[2026-10-23#^e-…]]`, and a `filed:` line of its own. The bar is stricter than placing a page (`citeOnLeaf`): the page's own name must match a word the root's name and summary do not already carry, and the score must be at least 3. The root keeps its citation; retrieval lineage picks the deepest citing page.
  - *Agent ops reports (rule 5, tree vaults only).* A Watcher read, console decision or wake report (`isAgentOpsReport`: first line names a repo/agent plus an epic or ticket id, and the text reads as telemetry) skips page filing. It becomes one dated line in the `## Ops rollup` section of its level-1 project node, e.g. `- 2026-11-01 ops (2): [[2026-11-01#^e-…]], [[2026-11-01#^e-…]]`. The node's `updated:` is left alone, so ops traffic never makes a root look ongoing; the weekly sweep (E9-2d) must not count the section as activity.
  - *`filed:` back on the Log entry (rule 6, every vault).* The line is appended, never inserted, so the Log stays append-only: `- filed: [[Notes/X]] (Working › Hair transplant › X)`, with `· provisional` or `· ops rollup` when they apply. A tree-less vault gets `- filed: [[Notes/X]]` without the path. When nothing was worth a page, it gets `- filed: log only (reason)`. If the entry is no longer the last one in the file, the line names it: `- filed e-1a2b3c: …` (no caret, so anchors stay unique). Each page is recorded once per entry (`parseFiledLines` reads both forms). Filings still pending a retry write nothing until they settle.
  - *One durable revision per capture.* Synchronous stores and unguarded enrichments carry the placement and the `filed:` line in their own commit. A receipt-guarded topic enrichment cannot add files, so its placement is one follow-up commit, and the returned result reports that revision.
  - A vault without `Tree.md` behaves exactly as before apart from the `filed:` line: no `parent:`, no leaves and no rollups are written.
- **The weekly sweep, the compactor (E9-2d, `packages/core/src/engine/treeSweep.ts`).** Once a week per tenant the sweep tidies a tree vault and decides nothing for the person:
  - *Stale working roots.* A working root whose whole subtree has no capture for 30 days (latest cited Log date or `filed:` line, outside `## Ops rollup`; a page that cites nothing counts from its `created:`) gets ONE proposal line: keep, close (one Outcome line, then it moves under Long-term memory) or fold into another root. The sweep never moves a root.
  - *Pending receipts.* An `Inbox/filing-…` or `Inbox/needs-filing-…` file at least 2 days old, with no filing job still queued for it, is re-filed with E9-2b's placement: if its capture already sits on a page, that page gets a parent when it lacks one; otherwise it becomes a provisional leaf under the closest node. The receipt then moves to `Archive/Inbox/`, byte for byte. Prepared (interrupted) filings and filings pending under a week old are left alone.
  - *Root-only citations (E9-2f).* A Log entry cited only by level-1 roots (outside `## Ops rollup`; for example the E9-2c clean-up's re-filed lines) gets the same leaf citation as a new filing, when a page below that root clears the same bar. Agent ops reports stay on the root (rule 5). Nothing is removed from the root; entries no deeper page fits stay as they are. The counts are `rootOnlyCitations` and `citationsDeepened`, and the commit message names `deepened N`.
  - *Duplicate titles.* Pages sharing a title get one merge proposal line (keep the placed, shallowest one). Nothing is merged.
  - *Where proposals go.* One vault page, `Inbox/Tree sweep.md`, rewritten only when its proposals change; the console reads a one-line count summary from `GET /api/console/memory-sweep`.
  - *Safety (E9-A2, "raw data stays safe").* Nothing is deleted (a removed Inbox file must have its exact bytes under `Archive/Inbox/`), `Log/` and `_attachments/` are never written, tree lint may not get worse, and all of a sweep's changes are ONE vault commit (`memory: weekly tree sweep (…)`), so `git revert` undoes it. Any failure reverts the working tree and commits nothing.
  - *Schedule.* A `tree_sweep` job on the tenant's durable task lane, queued by the per-tenant monitor tick in the first 02:00–06:00 UTC window from Sunday 02:00 UTC, keyed `tree-sweep:week:<Sunday>` so it runs once per week across restarts. The lane is serial and the engine takes the vault write lock on its background lane, so a sweep never runs alongside a live filing. `GET /api/memory/sweep` shows the next run and the last run's counts; `POST /api/memory/sweep/run` runs one now.

## Human-in-the-loop points

- **Autopilot**: filing/updating single notes from a capture.
- **Ask-when-unsure**: classification confidence low → ask, don't guess.
- **Proposal-first** (never auto): renames, merges, moves, bulk migrations, taxonomy changes. Plan approved before execution.
- **Periodic audit** (e.g. every ~10 ingestions or nightly): dupes, orphans, broken links, stale claims surfaced as proposals, not auto-fixed.
- **Append-only operation log** of every librarian action (we get this from git, plus `Log/` entries).

## Retrieval strategy

Community evidence: BM25/grep finds the right note >90% of the time under ~1K notes when one person writes and searches; Anthropic itself replaced Claude Code's vector search with grep. But agent-written notes erode the "same author, same vocabulary" assumption — vocabulary mismatch is the failure case.

- **v1 (M0):** lexical only — grep/ripgrep over bodies + frontmatter index pass. No embeddings.
- **Add semantic when**: vault >~1K notes, or human+agent vocabulary diverges, or for automated cross-link suggestions. Always as a rerank/discovery layer over lexical, never a replacement.

## The mental model (canonical)

Every memory has two parts:

1. **The evidence** — the verbatim artifact: what was said out loud, the voice note, the document. Date-stamped, filed, immutable. A receipt.
2. **The meaning** — what the evidence tells us, incorporated into living pages (projects, lines of thinking, life areas). Every claim on a meaning page references its evidence: *"leaning toward the south-facing flat (see voice note, June 3)."*

And the brain has two roles:

1. **The librarian** — runs on every message: files the evidence, updates the meaning pages it touches.
2. **The compactor** — runs periodically (nightly/audit cadence): merges duplicates, connects pages that should know about each other, tightens bloat. Adds no information; organizes and makes connections.

Differentiation in one line: *Karpathy gave the world the recipe; we're opening the restaurant.*
