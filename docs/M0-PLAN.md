# M0 Plan — Self-hosted Zenod

Status: **active**. Scoped 2026-06-11. Companion to [M0-SPEC.md](M0-SPEC.md) (the engine contract this milestone implements) and [ROADMAP.md](ROADMAP.md) (where M0 sits).

## Goal

One Docker container, deployed on our own VPS via Dokploy, used daily for a real vault. Concretely, M0 ships:

1. **The brain engine** — `store`, `ask`, `chat`, `search`, `get`, `lint` against a git-backed Obsidian vault, enforcing the two-tier evidence/meaning model. Exactly as specified in [M0-SPEC.md](M0-SPEC.md).
2. **An HTTP server** exposing the engine two ways: a small REST API, and a **remote MCP endpoint** (Streamable HTTP) with `search_memory`, `get_memory`, `store_memory`, `ask_brain` tools. Bearer-token auth on both.
3. **A settings web UI** (React + Vite + shadcn/ui, served by the same container) — first-run setup and ongoing configuration: vault repo, GitHub token, Anthropic key, models, MCP token. No terminal required after `docker run`.
4. **A Dockerfile** and a Dokploy deployment of it.

**Definition of done** = the six engine acceptance tests in [M0-SPEC.md](M0-SPEC.md) § Definition of done, plus three deployment tests:

7. The Docker image builds and runs with a single mounted volume; first boot walks through setup in the browser.
8. All configuration (vault repo, GitHub PAT, Anthropic key) is done through the settings UI, persists across container restarts, and includes a working "test connection" for both GitHub and Anthropic.
9. Claude Code (and Claude.ai via custom connector) connects to the deployed MCP endpoint with the bearer token, and `store_memory` / `ask_brain` round-trip against the live vault — used daily by user #1.

## Amendments to the original spec

[M0-SPEC.md](M0-SPEC.md) was closed 2026-06-10 with a CLI-only transport and Postgres state. Two amendments, decided 2026-06-11 with the self-host pivot (rationale in [ROADMAP.md](ROADMAP.md) § Decision log):

- **State store is SQLite by default** (`better-sqlite3`, one file on the container volume), not Postgres. The `StateStore` interface from the spec stands; a Postgres implementation can be added when the hosted repo needs it. A self-hosted product should be one container + one volume.
- **M0 includes the MCP transport** (the spec deferred it to M1) plus the settings UI and Dockerfile. The CLI remains, as the dev harness. WhatsApp shifts to M1.

Everything else in the spec — vault schema, librarian pipeline, git contract, lint rules, never-half-apply guarantee, the six acceptance tests — stands unchanged.

## Architecture

```
zenod/                      npm workspaces monorepo
├── packages/core/          the engine — no HTTP, no UI
│   └── zenod CLI bin       store|ask|chat|search|get|lint (dev harness)
├── packages/server/        Hono HTTP server: REST + MCP + serves built UI
├── apps/web/               React + Vite + shadcn/ui settings app
├── Dockerfile              multi-stage: build web+server → slim runtime
└── docs/                   this plan, spec, doctrine, roadmap
```

- **`packages/core`** — everything in the engine spec: `.brain/config.yml` loader, frontmatter parser, `lint()`, evidence-immutability diff check, two-pass search, git contract (clone to workdir, serialized write queue, pull→commit→push with rebase-retry), librarian store pipeline, ask/chat loops on the Claude Agent SDK. Zero HTTP. Testable without API keys up through the deterministic layers.
- **`packages/server`** — [Hono](https://hono.dev) app: `/api/*` REST routes, `/mcp` Streamable HTTP MCP endpoint (`@modelcontextprotocol/sdk`), static serving of the built web app, SQLite-backed `StateStore` + settings store. Bearer-token middleware on `/api` and `/mcp`; cookie session for the UI.
- **`apps/web`** — scaffolded with the official shadcn bootstrap (`npx shadcn@latest init --template vite`). Settings only in M0: setup wizard, configuration, status. Not a chat UI.
- **Runtime config model:** env vars bootstrap (`PORT`, `ZENOD_DATA_DIR`, optionally seed keys); everything else lives in SQLite and is editable in the UI. Secrets stay on the volume, never in the image.

### Security model (M0, single-user)

- First boot: UI prompts to create the admin password; an MCP/API bearer token is generated and shown in settings (regenerable).
- The container is exposed via Dokploy behind HTTPS (Traefik). No multi-user, no OAuth — that's the hosted repo's problem.

## Build phases

Deterministic core first, LLM last — every layer testable without API keys. Each phase lands as a PR with tests green in CI.

| # | Phase | Contents | Proves |
|---|---|---|---|
| 0 | **First commit** | README, LICENSE (AGPL-3.0), docs/ (this plan, roadmap, spec, doctrine) | Philosophy and plan are pinned before code |
| 1 | **Scaffold** | npm workspaces; `apps/web` via `npx shadcn@latest init --template vite`; `packages/core` + `packages/server` TS skeletons; CI (typecheck + test); `.brain/` fixture vault in `packages/core/test/` | Repo builds, tests run, UI dev server renders |
| 2 | **Schema layer** *(no LLM, no git)* | config loader, frontmatter parser, `lint()`, evidence-immutability diff check | Anti-rot rules are code, not prompts |
| 3 | **Deterministic ops** *(no LLM)* | `search` (frontmatter index pass → ripgrep pass), `get`, CLI wiring | <500ms search, zero LLM calls (DoD #3) |
| 4 | **Git contract** | clone-to-workdir, serialized write queue, pull→commit→push, rebase-retry ×3 | Concurrent stores serialize cleanly (DoD #4) |
| 5 | **Store pipeline** | evidence append → classify (haiku pass) → meaning update → validate-with-retry → commit; Inbox fallback | Never-half-apply; ask-don't-guess (DoD #1, #6) |
| 6 | **Ask / chat** | Claude Agent SDK loops, read-only tools, SQLite `StateStore` conversation window | Synthesized answers with citations (DoD #2) |
| 7 | **Server** | Hono REST + MCP Streamable HTTP + bearer auth + settings store | Claude Code connects over MCP locally |
| 8 | **Settings UI** | shadcn: setup wizard, vault/keys config with test-connection, status page, token management | Zero-terminal configuration (DoD #8) |
| 9 | **Ship** | Multi-stage Dockerfile, volume layout, Dokploy deploy, run full DoD suite (incl. the 50-store anti-rot run) against the live vault | DoD #5, #7, #9 — Zenod in daily use |

## Settings UI scope (M0)

Built from shadcn primitives (Field/FieldGroup forms, Card, Tabs, Alert, sonner toasts). Four screens, nothing more:

1. **Setup wizard** (first boot): create admin password → GitHub PAT + vault repo (`owner/name`, with "create for me" deferred — M0 assumes the vault repo exists) → Anthropic API key → clone & validate → done, here's your MCP URL + token.
2. **Vault** — repo, branch, workdir status, last sync, re-clone button, lint report view.
3. **Keys & models** — GitHub PAT, Anthropic key (masked, test buttons), ask/classify model pickers.
4. **Connections** — MCP endpoint URL, bearer token (show/regenerate), copy-paste snippets for Claude Code / Claude.ai connector setup.

## Out of scope for M0

WhatsApp (M1) · transcription (M1) · multi-user/billing/OAuth (M3, separate repo) · compactor cron (M2 — but its preconditions, citations + lint, ship now) · embeddings · web chat UI · GitHub App ("create a vault for me" flow) · Postgres `StateStore` implementation.
