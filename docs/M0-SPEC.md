# Zenod M0 Spec — the brain core engine

Implementable spec for the brain core engine. Companion to [LIBRARIAN-DOCTRINE.md](LIBRARIAN-DOCTRINE.md) (the rules) and [M0-PLAN.md](M0-PLAN.md) (the build plan). Status: **closed 2026-06-10**; amended 2026-06-11 — see [M0-PLAN.md](M0-PLAN.md) § Amendments (SQLite default state store; MCP transport, settings UI, and Dockerfile pulled into M0).

## What the engine is

A TypeScript library + thin CLI that, given a vault repo and a message, performs one brain operation — store, ask, search, get, or chat — against a git-backed Obsidian vault, enforcing the two-tier evidence/meaning model. Single-user. No WhatsApp (M1), no multi-user (M3, separate repo), no compactor cron (M2) — but everything the compactor needs (evidence links, lint) is laid down here.

## Stack

- **Language:** TypeScript / Node 22+.
- **Agent loop:** Claude Agent SDK. Default models, configurable: `claude-sonnet-4-6` for ask/chat loops, `claude-haiku-4-5` for classification passes.
- **Git:** simple-git; repo cloned to a per-user workdir.
- **State:** SQLite behind a `StateStore` interface — conversations and settings only; **the vault is the memory**. (Amended 2026-06-11; was Postgres.)
- **Search:** ripgrep + frontmatter scan. No embeddings in M0.
- **License:** AGPL-3.0.
- **Name:** product **Zenod**, domain zenod.dev. Repo `zenod-ai/zenod`. npm package `zenod`, CLI binary `zenod`.

## Vault schema v1 (the meta-schema, enforced in code)

Maps the two tiers onto simple folders — the user-visible vault stays a normal Obsidian vault, plus `Areas/` and a machine config dir:

```
.brain/config.yml     schema_version: 1, tag vocabulary, controlled values
AGENTS.md             human/LLM-readable doctrine (read first by every loop)
Index.md              home note
Inbox/                ONLY unresolved items (low-confidence filings awaiting the user)
Log/YYYY-MM-DD.md     EVIDENCE — append-only daily files
_attachments/<area>/  EVIDENCE — original documents/files
Projects/<Name>.md    MEANING — finite work
Areas/<Name>.md       MEANING — ongoing life domains
Notes/<Name>.md       MEANING — reusable knowledge
Archive/              retained inactive material (moves are proposal-only)
_templates/           templates
```

### Evidence entries (immutable)

Appended to `Log/YYYY-MM-DD.md`, each entry:

```markdown
## 14:32 Voice capture — thoughts on flat purchase  ^e-7f3a2c
- source: whatsapp | mcp | cli | web
- verbatim: yes

> [exact words, untouched]
```

- Block ID `^e-<6 hex>` is the stable citation anchor.
- Entries are append-only: no existing line in `Log/` or `_attachments/` may ever be modified or deleted by the engine. Enforced by a pre-commit diff check, not by prompt.
- Files go to `_attachments/<area>/` plus an evidence entry describing them.

### Meaning pages (living, regenerable)

`Projects/`, `Areas/`, `Notes/` pages. Required frontmatter (lint-enforced):

```yaml
title:      string
type:       project | area | note
tags:       [from .brain/config.yml vocabulary only]
created:    YYYY-MM-DD
updated:    YYYY-MM-DD
summary:    one line, written for a cold LLM context
```

Rules (lint-enforced): every claim derived from evidence cites it — `([[2026-06-10#^e-7f3a2c]])`; every page links ≥1 other page or its folder index (no orphans); pages are dense and self-contained (doctrine rule 8 — style-checked by the librarian, not lint).

## Engine API

```ts
interface BrainEngine {
  store(input: StoreInput): Promise<StoreResult>;   // librarian pipeline (writes)
  ask(question: string): Promise<Answer>;           // agent loop, read-only
  chat(message: string, surface: Surface): Promise<Reply>; // full turn: ask + optional store
  search(query: string): Promise<Hit[]>;            // deterministic, no LLM
  get(path: string): Promise<Note>;                 // deterministic, no LLM
  lint(): Promise<LintReport>;                      // deterministic validation
}
```

CLI harness: `zenod store|ask|chat|search|get|lint`. The MCP endpoint (M0) and WhatsApp (M1) are thin adapters over this same interface.

- `search`: two-pass — frontmatter index (title/tags/summary) then ripgrep over bodies; returns path, snippet, score, GitHub URL. Target <500ms, zero LLM calls. Same for `get`.
- `ask`: agent loop with read-only tools (`search_vault`, `read_note`, `list_pages`); system prompt = AGENTS.md + folder indexes; returns synthesized answer + cited sources (vault paths and GitHub URLs). Budgets: max 15 tool calls, configurable token cap.
- `chat`: rehydrates recent conversation window (last 20 messages or 48h, whichever smaller) from the `StateStore` + runs ask-style loop; may invoke the store pipeline when the user asks to remember something; logs both sides to the `StateStore`.

## The librarian pipeline (`store`)

1. **Normalize.** Text in; files copied to `_attachments/` (no transcription in M0 — voice arrives in M1).
2. **Record evidence.** Append entry with block ID to today's Log (verbatim if requested or if input is quoted speech).
3. **Classify.** One LLM pass (haiku-class) with the frontmatter index + tag vocabulary: which meaning page(s) does this touch, create-or-update, confidence 0–1.
4. **Branch on confidence.** ≥0.7: proceed. <0.7: write a stub to `Inbox/` marked `status: needs-filing` with a concrete question; return that question to the caller (ask-don't-guess).
5. **Update meaning.** Create/update the page(s): integrate the claim with evidence citation, refresh `updated` + `summary`, add wikilinks. New pages start from `_templates/`.
6. **Validate.** Run lint on changed files + evidence-immutability diff check. On failure: feed errors back to the LLM, max 2 retries, then fall back to Inbox stub. **A store can never half-apply: it lands valid, lands as an Inbox question, or fails cleanly.**
7. **Commit & push.** One commit per store. Author `zenod-bot`. Message: `memory: <one-line summary>`. Push with pull-rebase retry on conflict.
8. **Return** `{ evidenceRef, pagesTouched[], commitSha, githubUrls[], question? }`.

Bulk/destructive operations (rename, merge, move, taxonomy change) are **not** reachable from `store` — they exist only behind a separate `propose` path stubbed in M0 (returns "not implemented"), reserved for the compactor.

## Concurrency & git contract

- Per-user in-process queue: exactly one writing turn at a time; reads don't queue.
- Every turn: pull before, push after. Push rejection → pull --rebase, retry ×3, then surface error.
- Never force-push, never amend, never rewrite history. `git log` is the audit trail; Log/ is the narrative trail.
- Commit prefixes: `memory:` (librarian), `compact:` (reserved), `schema:` (migrations). Schema v1 migration = add `.brain/`, `Areas/`, templates to an existing simple vault.

## Config

Bootstrap env vars: `PORT`, `ZENOD_DATA_DIR` (volume: SQLite file + vault workdir). Runtime settings, editable in the UI and persisted in SQLite: vault repo (`owner/name`), `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, ask/classify models. Env vars may seed any runtime setting on first boot (`VAULT_REPO`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `ZENOD_MODEL_ASK`, `ZENOD_MODEL_CLASSIFY`).

## Definition of done (engine)

Run against the development vault (user #1's real vault):

1. `zenod store "I just got travel insurance with Axa, policy ends March 2027, store this verbatim"` → verbatim evidence entry in today's Log with block ID; `Areas/Insurance.md` created/updated citing it; lint passes; commit pushed; GitHub URLs returned.
2. `zenod ask "what do I know about my insurance?"` → synthesized answer citing the Area page and the evidence entry, with GitHub URLs.
3. `zenod search insurance` and `zenod get Areas/Insurance.md` return correct results in <500ms with no LLM call.
4. Two `store` calls fired concurrently serialize: two clean commits, no conflict, no interleaved writes.
5. **The anti-rot test:** 50 consecutive varied `store` calls (scripted fixtures) leave the vault with zero lint errors — no orphans, no invalid frontmatter, no out-of-vocabulary tags, no modified evidence lines.
6. A low-confidence store produces an Inbox stub + question instead of a guess.

Deployment acceptance tests (7–9) are defined in [M0-PLAN.md](M0-PLAN.md) § Goal.

## Explicitly out of scope (M0)

WhatsApp/Baileys · voice transcription · multi-user/auth/billing · compactor (only its preconditions: citations + lint + `compact:` prefix) · embeddings/semantic search · web chat UI · GitHub App flows (plain PAT in M0).
