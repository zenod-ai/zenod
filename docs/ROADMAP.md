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

## Milestones

### M0 — Self-hosted Zenod, deployed and useful (current)

One Docker container on Dokploy, used daily against a real vault. Engine (store / ask / chat / search / get / lint), HTTP API + remote MCP endpoint, settings web UI, Dockerfile.

**Done when:** Zenod runs on our VPS, is configured entirely through its own UI (vault repo, GitHub token, Anthropic key), Claude Code connects to it over MCP, and we store and retrieve real memories daily. Full plan and definition of done: [M0-PLAN.md](M0-PLAN.md). Engine contract: [M0-SPEC.md](M0-SPEC.md).

### M1 — WhatsApp gateway

A Baileys-based WhatsApp adapter over the same engine: text in, voice notes transcribed, documents filed into `_attachments/` with facts extracted. Whitelist by phone number. Talk to your brain from your pocket.

### M2 — Self-host polish

The "someone who isn't us installs it in 15 minutes" milestone: install docs, versioned Docker images on a registry, settings export/backup story, schema migrations, the compactor's first pass (nightly audit cron producing proposals, not auto-fixes).

### M3 — Hosted Zenod (separate repo)

Multi-tenant shell, GitHub App, Stripe, provisioning, platform-key metering. Built on the engine this repo ships; tracked elsewhere.

### Deferred / v2+

Web chat UI (Claude + the MCP connector covers conversational use meanwhile) · embeddings as a rerank layer over lexical search · per-user cloud runtimes (Cloudflare Durable Objects / Fly Machines) behind `BrainRuntime` · WhatsApp Business API · non-GitHub git hosts.

## Decision log

- **2026-06-10** — Name: Zenod (zenod.dev registered, `zenod-ai` org claimed). License: AGPL-3.0. Vault model: two-tier evidence/meaning ([LIBRARIAN-DOCTRINE.md](LIBRARIAN-DOCTRINE.md)). Engine spec closed ([M0-SPEC.md](M0-SPEC.md)).
- **2026-06-11** — Repo philosophy pinned: this repo is self-host-first; hosted is a separate later repo. M0 re-scoped from "CLI-only engine" to "deployed, daily-usable self-hosted container" — it absorbs the MCP endpoint (was M1) and adds the settings UI and Dockerfile; WhatsApp shifts to M1. State store: SQLite by default (one container + one volume, no external DB); Postgres stays possible behind `StateStore`. BYO Anthropic key in this repo; platform-key metering belongs to the hosted repo.
