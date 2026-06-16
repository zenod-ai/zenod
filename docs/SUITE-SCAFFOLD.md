# Zenod Suite — Target Architecture (base + modules)

The fully-defined target. Every step lands toward this. Approach: **Option B** —
build the clean shape in parallel (Zenod-v2), prove it, then cut over. The live
system is never mutated destructively.

## The one idea: a base, with modules bolted on

```
agent = THE BASE  +  one or more MODULES  +  identity/persona
```

- **THE BASE** is identical in every agent.
- A **MODULE** = tools + (optionally) a UI tab + (optionally) a store.
- An **agent app** is a tiny file: its identity + the list of modules it uses.
- All agents connect down to **one CENTRAL platform** and talk to each other over MCP.

## THE BASE — shared, identical in every agent

Two shared packages:

- **`base-server`** — the agent loop (chat + tool-calling) + the MCP server + the
  **connections-client** (talks to central). **No vault. No domain tools.** This is
  the minimal "an agent that can chat, expose an MCP, and reach central."
- **`base-ui`** — the shell: **Chat · Connections · Costs · login**. A shared React
  kit every agent imports.

**UI rule (the "change once" you asked about):**
- Change `base-ui` (the shell) → rebuild → **every agent gets it**.
- Each **module ships its own tab** as a component → only agents with that module get it.
- So: **shell change → everyone; module change → only its users.** Same UI everywhere,
  edited in one place, with per-agent tabs layered on.

## MODULES — the distinguishing part

A module bundles { tools, optional UI tab, optional store }:

- **`mod-memory`** — the vault (git memory) + librarian tools (search_vault, read_note,
  capture_note, list_pages, propose/execute_vault_task) + **Vault & Transcription** tabs. **Has a store (the vault).**
- **`mod-backlog`** — backlog/issue tools (create/edit/label_issue, query/service_backlog,
  approve_queue/merge) + a **Backlog** tab. **No vault.**
- **`mod-email`** — email tools (send/search/read) + an **Inbox** tab. **No vault.**

## THE AGENTS — base + module(s)

- **Zenod** = base + **`mod-memory`**. The **librarian**: owns the vault/memory.
  **Does NOT own the backlog** — it **delegates backlog work to Archus** over the mesh.
- **Archus** = base + **`mod-backlog`**. The backlog expert. **No vault.**
- **Mail** = base + **`mod-email`**. **No vault.**
- (future agents = base + their module.)

## CENTRAL — shared platform, deployed once

The connections/identity service (plain HTTP, **not** MCP): one stable GitHub App,
model/provider keys, Drive, and the **agent registry** that powers the mesh. Agents
reach it via the base's connections-client. See [[#140]].

## Mesh — agents talk

Each agent registers with central; agents call each other over MCP. **Peer tools are
labeled external** (e.g. `zenod.search_vault` / `ask_archus`) so "my tools" and
"peer tools" are never confused. Zenod → Archus for backlog; Archus → Zenod for memory.

## Repos & containers

**One monorepo:**
```
packages/base-server   packages/base-ui
packages/mod-memory    packages/mod-backlog    packages/mod-email
packages/central       (the connections/identity service)
apps/zenod  apps/archus  apps/mail              (thin: identity + module list)
```
**Containers (Dokploy):** `zenod`, `archus`, `mail` (one per agent), `central`, plus
islands (`x-mcp`). One agent = one container = base + its modules.

## Migration plan — Option B (parallel, then cut over)

Non-destructive: the live Zenod is untouched until a proven cutover.

1. **Extract the BASE** — vault-less `base-server` loop + `base-ui` kit + the module interface.
2. **Carve MODULES** — `mod-memory` (from today's vault engine), `mod-backlog` (from today's
   tasking tools), `mod-email`.
3. **Zenod-v2 = base + mod-memory** → deploy to a **temp domain** → prove parity
   (chat, vault, WhatsApp/Telegram). Live Zenod stays as-is.
4. **Archus = base + mod-backlog** (clean) → deploy (replaces the throwaway prototype).
5. **Mesh** — registry + peer tools (labeled external).
6. **Cutover** — point `app.zenod.dev` → Zenod-v2, retire the old. Reversible domain swap;
   same vault data.

## Ticket re-assessment

- **#140** shared auth → CENTRAL platform (stays).
- **#142** scaffold → re-scope to **extract the BASE + module interface** (phase 1).
- **#143** Nearchus deploy → current Archus is a **throwaway prototype** (runs full Zenod);
  rebuild as base + mod-backlog (phase 4).
- **#144** backlog tooling → **`mod-backlog`** (phase 2).
- **#145** mesh → stays (phase 5).
- **#146** gate → stays (milestone check).
- **#147** Mail → base + **`mod-email`**.
- **#148** X migration → island, central-managed (stays).

## Why this is clean, not fragile

- The base is small and shared; modules are isolated; agents are config.
- The target is *simple* — the only hard part is migrating off the vault-coupled engine,
  and Option B does that in parallel so the live system is never at risk.
- Editing the UI once updates all agents; a module change touches only its users.
