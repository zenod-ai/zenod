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

## The agents — all the SAME shape (uniform, no exceptions)

**Every agent is the same kind of thing.** Same base: server + MCP + connections-client +
a **web UI with a chat** (an LLM in the UI). Each adds its **own tools** and its **own
special UI tab(s)**. You can chat with *any* of them. There are **no "workers," no
"tool-islands."** X is an agent. Epaminon is an agent. Whether an agent's tools are
deterministic (post a tweet) or reasoning is irrelevant — the LLM lives in the UI, the
tools are just tools.

The **only** thing that is not an agent is **Central** — the shared backend they all
connect to (see below).

Every agent's UI = the **base tabs** (**Chat · Connections · Costs · login**) **+ its own
special tab(s)**.

| Agent | Job | Owns | Repos it can touch | Vault | Its tools | Special UI tab(s) | Subdomain | Container | Status |
|---|---|---|---|---|---|---|---|---|---|
| **Zenod** | memory / librarian | the vault | **only** the vault repo (obsidian-brain) | **yes** | search_vault, read_note, list_pages, search_chats, capture_note, propose/execute_vault_task | **Vault · Transcription** | app.zenod.dev | `zenod` | **LIVE** |
| **Archus** | backlog | the backlog | the repos it manages (cross-org) | no | query/service/digest_backlog, create/edit/label_issue, approve_queue/merge | **Backlog** | archus.zenod.dev | `archus` | **LIVE** (rebuild) |
| **Epaminon** | executor | execution (fan-out, PRs, merges) | the code repos it works (broad, gh) | no | drain queue, Codex fan-out, open PR, merge-on-green | **Runs** (fan-out dashboard) | epaminon.zenod.dev | `epaminon` | **LIVE** (headless today → +UI) |
| **Mail** | email | email access | — | no | send/search/read email | **Inbox** | mail.zenod.dev | `mail` | **planned** |
| **X** | post/read on X | the @ZenodAgent creds | — | no | post_tweet, read_tweets | **Feed · Compose** | x.zenod.dev | `x` | **LIVE** (tools vendored → +UI) |
| **Reddit** | post/read on Reddit | the Reddit creds | — | no | submit_post, search, read_subreddit, comment | **Subreddits · Compose** | reddit.zenod.dev | `reddit` | **planned** (new) |
| **Nectary** | financing | the funding layer | financing repos | no | (TBD) | **Ledger** | nectary.zenod.dev | `nectary` | **future** |

How they relate (over the mesh):
- **Zenod** (memory) **delegates backlog to Archus** — no Archus, no backlog. Clean.
- **Archus** curates + gates the backlog (brain); **Epaminon** drains queued tickets and does the code work (muscle).
- **X** and **Reddit** are agents you chat with to post/read; their tools call the platform APIs (X's tools come from the vendored xmcp, but the **agent shape is identical** to every other agent).
- Every agent exposes its tools over MCP; **peer tools are labeled external** in any agent's tool list.
- Each agent is **independent**: own container, own subdomain, own UI — deletable, restartable, monitorable on its own.

## CENTRAL — the shared backend (the ONE non-agent)

Plain HTTP service (no chat, no public UI): one stable **GitHub App**, model/provider keys,
Drive, and the **agent registry** (powers the mesh). Every agent connects to it via the
base's connections-client. Container `central`, **internal only**. *Not built yet — building
it is a phase.*

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
packages/base-server   packages/base-ui          (the shared base — every agent imports it)
packages/central       (the connections/identity service — the one non-agent)
apps/zenod  apps/archus  apps/epaminon  apps/mail  apps/x  apps/reddit  apps/nectary
                         (every agent: identity + its tools + its special tab(s))
services/xmcp                                     (vendored X tools that apps/x wraps)
```
**Containers (Dokploy, side by side):**

| Container | Agent | Subdomain | Status |
|---|---|---|---|
| `zenod` | Zenod | app.zenod.dev | live |
| `archus` | Archus | archus.zenod.dev | live (rebuild) |
| `epaminon` | Epaminon | epaminon.zenod.dev | live (headless → +UI) |
| `x` | X | x.zenod.dev | live (vendored tools → +UI) |
| `mail` | Mail | mail.zenod.dev | planned |
| `reddit` | Reddit | reddit.zenod.dev | planned (new) |
| `nectary` | Nectary | nectary.zenod.dev | future |
| `central` | Central (backend) | internal only | planned |

One agent = one container = one subdomain. Side by side as endpoints — monitorable,
restartable independently.

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
