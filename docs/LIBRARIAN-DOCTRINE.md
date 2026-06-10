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
3. **Links over folders.** Every distilled page links to related pages; orphans fail validation.
4. **Minimal enforced frontmatter**: title, type, tags (controlled vocabulary), created, updated, summary. Enables cheap two-pass retrieval: scan titles/tags/summaries first, open bodies only when needed.
5. **Schema doc at root** (AGENTS.md) — the agent reads it first; validation code enforces it regardless.
6. **Meta-schema fixed; taxonomy evolves by proposal.** Folder set, frontmatter keys, naming, linking rules change only via versioned migrations. Tags/MOCs evolve through explicit, logged proposals.
7. **Entity pages are the primary write target.** Distillation lands on interlinked entity/topic pages, not a journal — the Log stays as a raw source, so knowledge compounds instead of accumulating.
8. **Write distilled pages for LLM readers**: dense, self-contained, explicit links — a page must survive being dropped cold into a context window with no implicit shared context.

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
