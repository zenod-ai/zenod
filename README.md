# Zenod

**A self-hosted AI memory agent that owns your Obsidian vault.**

Zenod is a service you run on your own server. It is the single interface between AI agents and your personal knowledge vault — a plain markdown Obsidian vault living as a git repo in your own GitHub account. Agents talk to Zenod (via MCP today, WhatsApp and more later); Zenod reads and writes the vault on their behalf, enforcing the vault's organization rules so your memory compounds instead of rotting.

Named after [Zenodotus of Ephesus](https://en.wikipedia.org/wiki/Zenodotus), first librarian of the Library of Alexandria.

## Philosophy: self-hosted, user-owned

This repository is the **open-source, self-hosted Zenod**. The deal is simple:

- **Your vault.** Plain markdown in a git repo in *your* GitHub account. Exportable with zero data loss — it's just files. Open it in Obsidian any time.
- **Your server.** One Docker container on your own VPS (we deploy ours with [Dokploy](https://dokploy.com)). One volume for state. No external services required beyond GitHub and the Anthropic API.
- **Your keys.** You bring your own Anthropic API key and GitHub token. They live on your box, configured through Zenod's own settings UI.
- **Auditable memory.** Every memory Zenod stores is a git commit in your vault. `git log` is the audit trail; every fact has a provenance link back to the evidence that produced it.

A hosted, multi-tenant version of Zenod (managed provisioning, billing, no-VPS-required) is planned as a **separate product in a separate repository**, built on this engine. Nothing in this repo will ever depend on it. If you can run a container, you never need it.

## What Zenod does

Two roles, one engine (full doctrine in [docs/LIBRARIAN-DOCTRINE.md](docs/LIBRARIAN-DOCTRINE.md)):

1. **The librarian** — runs on every message. Files the verbatim **evidence** (append-only, immutable, block-ID citations), then updates the living **meaning pages** (Areas, Projects, Notes) that the evidence touches, with a citation link for every claim. When unsure where something belongs, it asks instead of guessing.
2. **The compactor** *(later milestone)* — runs periodically. Merges duplicates, connects pages, tightens bloat. Adds no information.

Agents never get raw file CRUD. The write path is the product.

## Status

**Pre-alpha. Milestone 0 in progress** — see [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/M0-PLAN.md](docs/M0-PLAN.md).

M0 ships a single self-hostable container: the brain engine, an HTTP API + remote MCP endpoint, a settings web UI (React + Vite + shadcn/ui), and a Dockerfile — deployed on our own VPS and used daily for our own vault. We are user #1.

## Architecture at a glance

```
┌─────────────────────────── one container ───────────────────────────┐
│                                                                      │
│  Web UI (React/Vite/shadcn) ──┐                                      │
│  MCP endpoint (Streamable HTTP)├──► Brain engine ──► vault workdir   │
│  HTTP API / CLI ──────────────┘    store · ask · chat     │          │
│                                    search · get · lint    │ git      │
│  SQLite (settings, conversations,                         ▼          │
│  job queue) on a volume                          your GitHub vault   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Engine spec:** [docs/M0-SPEC.md](docs/M0-SPEC.md)
- **Vault rules:** [docs/LIBRARIAN-DOCTRINE.md](docs/LIBRARIAN-DOCTRINE.md)
- **Stack:** TypeScript / Node 22+, Claude Agent SDK, simple-git, ripgrep, SQLite, React + Vite + shadcn/ui.

## License

[AGPL-3.0](LICENSE). Your vault content is yours; this license covers the code.
