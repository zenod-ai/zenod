# Zenod Roadmap

Last updated: 2026-06-11. This document is the development plan for the open-source, self-hosted Zenod — the only product this repository builds.

## The two-repo split (decided 2026-06-11)

| | **This repo (`zenod-ai/zenod`)** | **Hosted repo (private, later)** |
|---|---|---|
| Product | Self-hosted Zenod: one container you run on your own VPS | Managed Zenod: we run it for you |
| Users | People who can run a Docker container | Everyone else |
| Anthropic key | Bring your own | Platform key, usage metered per user |
| GitHub access | Your PAT, configured in the settings UI | GitHub App, OAuth flow |
| Tenancy | Single user per container | Multi-tenant |
| Billing | None, ever | Stripe |
| License | AGPL-3.0 | Proprietary |

The hosted repo wraps this engine; this repo never depends on the hosted repo. Engine interfaces (`BrainEngine`, `StateStore`, `BrainRuntime`, per-user write queue) stay clean so the hosted shell can reuse them without forking — but single-user self-hosting is the design center here, not a degraded mode of a SaaS.

## The core design problem — the storage substrate IS the product

**This is the central design decision for systematic ingestion, not a feature.** As we move from occasional manual stores to high-volume automatic ingestion (voice notes, documents, chats — see M1 / M1.5), the question of *how memory is stored so it can be retrieved, maintained, and mined* becomes the whole game. How we solve this is what we are selling.

A storing system that works has to satisfy three constraints at once:

1. **Simplifies retrieval** — any question, including *"where is the original artifact?"*, returns the right note(s) and the source links, cheaply and reliably.
2. **Efficient to maintain** — the structure doesn't rot as it grows; the compactor can keep it tidy without unbounded cost; adding a new capture doesn't require re-threading the whole vault.
3. **Effective to mine** — an agent (or many) can point an LLM at the corpus and systematically extract, connect, and act on what's there — the "repo mining" loop. The layout has to be legible to agents, not just to a human reading Obsidian.

**Concrete gap found 2026-06-11 (live test).** After ingesting two voice notes through `store_memory`, Zenod could retrieve the *distilled meaning* (`Projects/RepoMiningFunding.md`) with a cited answer — but asked *"where are the transcripts and their audio?"* it returned **nothing**. Cause: retrieval surfaces the *meaning* tier (pages with titles/summaries) but does **not** reach the immutable *evidence* tier (`Log/`, `_attachments/`) where the raw transcript text and the Google Drive audio links actually live — and the librarian did not carry those source links forward onto the distilled page. So the one layer retrieval reaches lacks the locations, and the layer that has them isn't reached.

**Follow-up test, same day, after fixing the vault by hand.** A librarian pass added a `## Sources` section (Drive audio links + evidence refs) to the meaning pages and pushed. Results: (a) the search index only picked up the new pages after the next `store_memory` call — the **read path does not sync/reindex from origin on its own** (writes force the sync; reads can serve a stale snapshot indefinitely); (b) even with a fresh index and the answer sitting verbatim on an indexed page, `ask_brain` **still failed the provenance question** — its research loop never opened the page whose body contained the answer, suggesting it leans on titles/summaries and doesn't fall through to bodies or to `Log/` receipts. So three distinct defects: evidence tier unindexed, source links not propagated (fixed by convention above), and a read-path that is both stale and shallow.

Design directions to resolve (to be specced, this drives M1/M1.5 and the retrieval engine):
- Index the evidence + attachment tiers (`Log/`, `_attachments/`), not just distilled pages — two-pass retrieval must be able to fall through to receipts and artifacts.
- Have the librarian propagate **source links** (artifact path / Drive URL / evidence `^ref`) onto every distilled page it writes, so "where's the original?" is answerable from the meaning layer alone.
- Treat artifact provenance (where the raw thing lives — held in `_attachments/` or referenced by external link) as a first-class, queryable field, not free text buried in a receipt.
- Keep the substrate legible to mining agents: stable refs, predictable frontmatter, links over folders.

See [FILING-LATENCY-SCHEMA.md](FILING-LATENCY-SCHEMA.md) for the current filing pipeline map, latency drivers, and the proposed capture-record schema iteration.

## Milestones

### M0 — Self-hosted Zenod, deployed and useful (current)

One Docker container on Dokploy, used daily against a real vault. Engine (store / ask / chat / search / get / lint), HTTP API + remote MCP endpoint, settings web UI, Dockerfile.

**Done when:** Zenod runs on our VPS, is configured entirely through its own UI (vault repo, GitHub token, Anthropic key), Claude Code connects to it over MCP, and we store and retrieve real memories daily. Full plan and definition of done: [M0-PLAN.md](M0-PLAN.md). Engine contract: [M0-SPEC.md](M0-SPEC.md).

### M1 — WhatsApp gateway

A Baileys-based WhatsApp adapter over the same engine: text in, voice notes transcribed, documents filed into `_attachments/` with facts extracted. Whitelist by phone number. Talk to your brain from your pocket.

### M1.5 — Google Drive ingestion connector

**Status: first slice shipped — conversational ingestion with inbox/archive.** Drive connects from the Connections tab (service-account JSON + folder ID + a Groq or OpenAI key for transcription); the chat loop and the MCP endpoint expose `list_drive_files` / `ingest_drive_file`, which download a file, transcribe audio (Groq `whisper-large-v3-turbo` or OpenAI `whisper-1`, with an ffmpeg downsample for oversize files), and run it through the librarian store pipeline with the Drive link recorded as evidence provenance. The shared folder is the inbox and Drive is the binary store: after a successful ingest the file moves to an auto-created `Archive/` subfolder (same file ID, so the evidence link stays valid) — the vault never holds binaries, only pointers. Still open from the plan below: the poller (auto-ingest with no chat in the loop) and the processed-ID dedup table.

A Zenod-level connector that watches a Google Drive folder and auto-ingests new files into the vault, no chat app in the loop. Same downstream path as the WhatsApp gateway (voice notes transcribed, documents filed into `_attachments/`, facts extracted) but the source channel is a Drive folder you drop things into.

Design center — cheapest durable path, single-user:
- **Auth: service account + shared folder.** A Google Cloud service account; the user shares one "Zenod Inbox" folder with its email. No OAuth consent screen, no refresh-token lifecycle, no Google verification — works on any Drive (Workspace or personal). Service-account JSON stored in the settings store alongside the other secrets.
- **Watch: poll, not webhook.** Periodic `files.list` on the watched folder filtered by `modifiedTime > lastSeen`; download new files via `alt=media`. (Drive `files.watch` push is deferred — needs channel renewal against the public endpoint, not worth it for one user.)
- **Transcription: reuse the hermes provider envelope** (`{success, transcript, provider, error}` over pluggable backends — `local` faster-whisper / `groq` free-tier `whisper-large-v3-turbo` / openai / etc.). On a small VPS the cloud STT path (Groq) beats CPU whisper. Pre-step: ffmpeg → 16 kHz mono to stay under the 25 MB cloud cap and shrink uploads ~10×.
- **Filing:** raw artifact into the immutable `_attachments/` tier, verbatim transcript recorded as evidence, both source-linked back to the Drive file ID.

Ingestion conditions (configurable):
- only the designated watched folder(s);
- allowed mime types (audio, pdf, common docs) — ignore the rest;
- size ceiling, with ffmpeg downsample for oversize audio;
- dedup by Drive file ID (a processed-ID table) so re-runs and re-syncs never double-file;
- optional: move/label the file in Drive after successful ingest so the folder reflects what's been consumed.

**Done when:** dropping a voice note or document into the Zenod Inbox folder results, within the poll interval, in the raw artifact filed under `_attachments/` and (for audio) a verbatim transcript stored as evidence — with no manual step.

### M2 — Self-host polish

The "someone who isn't us installs it in 15 minutes" milestone: install docs, versioned Docker images on a registry, settings export/backup story, schema migrations, the compactor's first pass (nightly audit cron producing proposals, not auto-fixes).

### M3 — Hosted Zenod (separate repo)

Multi-tenant shell, GitHub App, Stripe, provisioning, platform-key metering. Built on the engine this repo ships; tracked elsewhere.

### Deferred / v2+

Web chat UI (Claude + the MCP connector covers conversational use meanwhile) · embeddings as a rerank layer over lexical search · per-user cloud runtimes (Cloudflare Durable Objects / Fly Machines) behind `BrainRuntime` · WhatsApp Business API · non-GitHub git hosts.

## Decision log

- **2026-06-10** — Name: Zenod (zenod.dev registered, `zenod-ai` org claimed). License: AGPL-3.0. Vault model: two-tier evidence/meaning ([LIBRARIAN-DOCTRINE.md](LIBRARIAN-DOCTRINE.md)). Engine spec closed ([M0-SPEC.md](M0-SPEC.md)).
- **2026-06-11** — Repo philosophy pinned: this repo is self-host-first; hosted is a separate later repo. M0 re-scoped from "CLI-only engine" to "deployed, daily-usable self-hosted container" — it absorbs the MCP endpoint (was M1) and adds the settings UI and Dockerfile; WhatsApp shifts to M1. State store: SQLite by default (one container + one volume, no external DB); Postgres stays possible behind `StateStore`. BYO Anthropic key in this repo; platform-key metering belongs to the hosted repo.
- **2026-06-11** — Pinned the core design problem ("the storage substrate IS the product"): the storing system must simultaneously simplify retrieval, stay efficient to maintain, and be effective to mine. Triggered by a live test — Zenod retrieved distilled meaning but could not answer "where are the transcripts/audio?" because retrieval doesn't reach the evidence/`_attachments` tier and distilled pages don't carry source links. This drives the retrieval engine and the M1/M1.5 ingestion work.
- **2026-06-11** — Added M1.5: a Zenod-level Google Drive ingestion connector (watched folder → auto-ingest), prompted by manually transcribing two voice notes dropped in Drive. Chosen path is service-account + shared folder + polling (no OAuth flow) and reusing the hermes transcription provider envelope; the OAuth "Connect Drive" button is left to the hosted repo.
- **2026-06-11** — M0 built end to end (phases 0–9): engine with 48 deterministic tests, MCP endpoint verified with the MCP SDK client, settings UI, Docker image smoke-tested, deployed on Dokploy as `app.zenod.dev`. Live DoD suite ([dod.test.ts](../packages/core/test/dod.test.ts)) is env-gated on `ANTHROPIC_API_KEY` and runs against a scratch clone — never the real remote; `ZENOD_DOD_FULL=1` enables the 50-store anti-rot run.
