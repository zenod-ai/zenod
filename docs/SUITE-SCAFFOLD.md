# Zenod Suite — Target Architecture (THE CONTRACT)

This is the single source of truth. We build **to** it. Decisions here are settled —
changing one is a deliberate edit to this file, never silent drift. Migration is
**Option B** (build in parallel, prove, cut over); the live system is never mutated
destructively.

## The vision (settled)

**Each capability is its own independent agent.** You install the ones you want —
like installing Excel, or Excel + PowerPoint, or all of Office. Agents are clean,
isolated endpoints (own container, own UI, own MCP); the **mesh** connects whatever
you've turned on.

Why this shape: a precise **control surface** per agent, real **isolation**, the
ability to **train each agent properly** for its one job, and **flexibility** (point
an agent at whatever repos it needs — no more, no less). It is not "more complex" —
it is **fewer concerns per box**.

## Non-negotiable principles

1. **One agent, one job.** No agent is a do-everything.
2. **Capability = a separate agent**, NOT an in-process plugin/module registry.
3. **The base is shared code** (so agents are not forks) — nothing more.
4. **An agent only gets access to the repos its job needs.**
5. **Turn capabilities on by running their agent**; they connect via the mesh.
6. **Opt-in beats bloat.** A dependency between agents (delegation over the mesh) is the
   accepted price of isolation — and you only pay it for capabilities you turned on.

## THE BASE — shared, identical in every agent

Just two shared packages (code reuse, not a runtime):
- **`base-server`** — the agent loop (chat + tool-calling) + MCP server + the
  **connections-client** (talks to central). **No vault. No domain tools.**
- **`base-ui`** — the shell: **Chat · Connections · Costs · login**. A React kit every
  agent imports.

**UI rule:** change `base-ui` (the shell) → every agent gets it. Each agent's own tab
ships with that agent → only it changes. *Shell change → all; agent tab → only that agent.*

## AN AGENT = base + its own capability code

```
agent = base-server + base-ui  +  {its tools, its UI tab(s), optional store}  +  identity/persona
```
That "its own code" is the *agent's* package — there is no generic module system to
register into. An agent is a thin app: identity + its tools + its tab(s), deployed as
its own container.

## The full roster

Three **kinds** of unit, all on the shared network, all reachable as MCP:
- **chat-agent** = base + a capability + chat UI (you talk to it).
- **worker** = headless, queue-driven (no chat UI; it executes).
- **tool-island** = headless tool provider, used *by* agents (often vendored).
- **platform** = the shared central service.

| Unit | Kind | Job | Owns | Repo access | Vault | Its own tools | Container | Subdomain | Status |
|---|---|---|---|---|---|---|---|---|---|
| **Central** | platform | broker connections + identity + registry | the GitHub App, model keys, Drive creds, agent registry | (holds the App; installed per-org) | no | — (serves creds + registry, not chat tools) | `central` | internal only | **planned** |
| **Zenod** | chat-agent | memory / librarian | the vault (git memory) | **only** the memory/vault repo (obsidian-brain) | **yes** | search_vault, read_note, list_pages, search_chats, capture_note, propose_vault_task, execute_vault_task | `zenod` | app.zenod.dev (z2 while migrating) | **LIVE** |
| **Archus** (Nearchus) | chat-agent | backlog | the backlog (issues across repos) | the repos it manages (cross-org via the App) | no | query_backlog, service_backlog, digest_backlog, create_issue, edit_issue, label_issue, approve_queue, approve_merge | `archus` | archus.zenod.dev | **LIVE** (prototype → rebuild clean) |
| **Epaminon** | worker | executor / runner | execution (fan-out, PRs, merges) | the code repos it works (broad, via gh) | no | drain queued tickets, fan-out Codex workers, open PR, merge-on-green | `zenod-agent-runner` | internal (status UI later) | **LIVE** |
| **Mail** | chat-agent | email | email access | — | no | send_email, search_email, read_email | `mail` | mail.zenod.dev | **planned** |
| **X** (Twitter) | tool-island | post/read tweets | the @ZenodAgent X creds | — | no | post_tweet, read_tweets (consumed by Epaminon/agents) | `x-mcp` (readonly + postread) | internal only | **LIVE** (vendored) |
| **Nectary** | chat-agent | financing / incentives | the funding layer | financing repos | no | (TBD) | `nectary` | nectary.dev | **future** |

How they fit together:
- **Zenod** (memory) **delegates backlog** to **Archus** over the mesh — if you don't run Archus, Zenod simply has no backlog.
- **Archus** curates + gates the backlog; **Epaminon** drains queued tickets and does the actual code work (Codex fan-out, PRs). Backlog *brain* (Archus) vs *muscle* (Epaminon).
- **X** is a tool-island Epaminon/agents call to tweet; it isn't a chat-agent (vendored, headless).
- **Central** brokers auth + the registry for everyone.
- Each unit is **independent**: deletable, restartable, monitorable on its own.

## CENTRAL — shared platform (prerequisite, NOT yet built)

Plain HTTP service (not MCP) holding: **one stable GitHub App**, model/provider keys,
Drive, and the **agent registry** (powers the mesh). Agents reach it via the base's
connections-client. *Status: not built — today creds are copied by hand. Building it is
a phase, not an assumption.*

## Mesh — agents talk

Each agent registers with central; agents call each other over MCP. **Peer tools are
labeled external** (e.g. `archus.create_issue`, `ask_zenod`) so "my tools" vs "a peer's
tools" is never ambiguous in any agent's tool list.

## Repos & containers

**One monorepo:**
```
packages/base-server   packages/base-ui          (the shared base)
packages/central       (the connections/identity service)
apps/zenod  apps/archus  apps/mail  apps/nectary (thin chat-agents: identity + tools + tab)
apps/epaminon                                    (the executor/worker — headless)
services/x-mcp                                   (vendored Twitter tool-island)
```
**Containers (Dokploy, side by side):**

| Container | Unit | Status |
|---|---|---|
| `zenod` | Zenod | live |
| `archus` | Archus | live (rebuild) |
| `zenod-agent-runner` | Epaminon | live |
| `x-mcp` (readonly + postread) | X | live |
| `central` | Central platform | planned |
| `mail` | Mail | planned |
| `nectary` | Nectary | future |

One unit = one container. They sit side by side as endpoints — monitorable, restartable
independently.

## Migration — Option B (parallel → prove → cut over)

1. **Spike (FIRST):** prove the base separates from the vault — stand up the bare base
   (loop + MCP + UI + connections, **no vault, no tools**) as a running agent on `z2`.
   If clean → proceed. If it fights → rethink before building. *Converts the one real
   unknown to fact.*
2. **Extract the base** (`base-server` vault-less loop + `base-ui`).
3. **Build Zenod-v2 = base + memory capability** → deploy to **z2.zenod.dev**, same vault
   data → **prove parity** (chat, vault, gateways). Live Zenod untouched.
4. **Rebuild Archus = base + backlog capability** (replaces today's throwaway prototype).
5. **Mesh** + **central** (extract connections into the shared platform).
6. **Cutover** — point `app.zenod.dev` → Zenod-v2, retire old.

**Honest cutover caveats (planned, not surprises):** Zenod has state beyond the vault —
the **WhatsApp session**, conversation history, usage, oauth — in v1's SQLite volume; it
must be migrated to v2's, and **two Zenods cannot share one WhatsApp number** (428
conflict), so v2 runs WhatsApp-disabled while proving, and we move the session at cutover.

## Ticket re-assessment

- **#140** shared auth → **CENTRAL** (stays; phase 5).
- **#142** scaffold → **extract the base + spike** (phases 1–2).
- **#143** Nearchus deploy → today's Archus is a **throwaway prototype** (runs full Zenod);
  rebuild as base + backlog (phase 4).
- **#144** backlog tooling → the **backlog capability** in `apps/archus` (phase 4).
- **#145** mesh → stays (phase 5).
- **#146** gate → stays (final check).
- **#147** Mail → base + email capability.
- **#148** X migration → island, central-managed (stays).

## Open risks we are tracking (not hiding)

- The base/vault separation is unproven until the **spike** (phase 1) — that's why it's first.
- **Central** does not exist yet — it is a built phase, not a given.
- **Cutover** needs WhatsApp/SQLite state migration (see caveats above).
