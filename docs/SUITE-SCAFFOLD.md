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
7. **Grouping is by JOB, not by MCP server.** An agent may compose **several MCP servers
   internally** (a gateway that mounts upstream servers and re-exposes their tools). That is
   private plumbing — externally it is still **one agent: one chat, one UI, one tool surface.**
   Example: **Outbound** = one agent whose job is outbound comms, internally composing the
   X + Reddit + email servers.

## THE BASE — shared, identical in every agent

Just two shared packages (code reuse, not a runtime):
- **`base-server`** — the agent loop (chat + tool-calling) + MCP server + the
  **connections-client** (talks to central). **No vault. No domain tools.**
- **`base-ui`** — the shared UI shell: **the chat** (the UX) + **Connections · Costs · login**
  (setup). **Extensible on a tab basis:** an agent can fold in its own **config tab(s)** for
  setup its job needs — Zenod's **Vault** tab, or another agent's API-credential panel. The
  base ships the shell; the agent adds its config tab(s).

**The chat is the UX — config tabs are the one allowed extension.** You *use* every agent
through its chat. The only extra tabs permitted are **config/setup tabs** (like Vault) —
**never content surfaces** (no inbox, no feed, no ledger, no dashboard). The test: a tab may
**configure** an agent; a tab must **never become how you use it**.

**UI rule (this gives you exactly what you asked for):** change the shared shell in `base-ui`
→ **every agent gets it**. An agent's own config tab ships with that agent → **only it has
it**. *Shell change → all; an agent's config tab → only that agent.*

## AN AGENT = base + its own tools (+ optional config tab)

```
agent = base-server + base-ui  +  {its tools, optional config tab(s), optional store}  +  identity/persona
```
No content tabs, no module registry. An agent is a thin app: identity + its tools + (where its
setup needs it) a config tab. The shared shell (chat + setup) is the base, unchanged.

## The agents — all the SAME shape (uniform, no exceptions)

**Every agent is the same kind of thing.** Same base: server + MCP + connections-client +
**the same chat shell**. The differences between any two agents are just **(1) the tools
wired into the chat** and **(2) any config tab its setup needs** (e.g. Zenod's Vault). You
talk to *all* of them the same way — through the chat. There are **no "workers," no
"tool-islands," and no content tabs.** Whether an agent's tools are deterministic (post a
tweet) or reasoning is irrelevant — the LLM lives in the chat, the tools are just tools.

The **only** thing that is not an agent is **Central** — the shared backend they all
connect to (see below).

Same chat shell everywhere. The two things that vary are **its tools** and **any config tab
its setup needs** (setup only — never a content surface; the UX is always the chat).

| Agent | Job | Owns | Repos it can touch | Vault | Its tools (wired into its chat) | Config tab (setup) | Subdomain | Container | Status |
|---|---|---|---|---|---|---|---|---|---|
| **Zenod** | memory / librarian | the vault | **only** the vault repo (obsidian-brain) | **yes** | search_vault, read_note, list_pages, search_chats, capture_note, propose/execute_vault_task | **Vault** | app.zenod.dev | `zenod` | **LIVE** |
| **Archus** | backlog | the backlog | the repos it manages (cross-org) | no | query/service/digest_backlog, create/edit/label_issue, approve_queue/merge | — | archus.zenod.dev | `archus` | **LIVE** (rebuild) |
| **Epaminon** | executor | execution (fan-out, PRs, merges) | the code repos it works (broad, gh) | no | drain queue, Codex fan-out, open PR, merge-on-green | — | epaminon.zenod.dev | `epaminon` | **LIVE** (headless today → +chat UI) |
| **Outbound** | outbound comms: post + email | the X + Reddit + email creds | — | no | post_tweet, read_tweets, submit_post, read_subreddit, comment, send_email, search_email — *composed from 3 internal MCP servers* | — *(creds via Connections; add one if needed)* | outbound.zenod.dev | `outbound` | **partial** (X tools vendored LIVE → +Reddit +Mail) |
| **Nectary** | financing | the funding layer | financing repos | no | (TBD) | — | nectary.zenod.dev | `nectary` | **future** |

How they relate (over the mesh):
- **Zenod** (memory) **delegates backlog to Archus** — no Archus, no backlog. Clean.
- **Archus** curates + gates the backlog (brain); **Epaminon** drains queued tickets and does the code work (muscle).
- **Outbound** is one agent you chat with to post to social + send email; it **composes three MCP servers internally** (vendored **xmcp** + **reddit-mcp-server** + an email server) and exposes them as one tool surface — the **agent shape is identical** to every other agent. Internal composition is invisible plumbing. You use it through the chat ("post this to X and Reddit and email it to Jordi"), not through any inbox/feed UI — there isn't one.
- Every agent exposes its tools over MCP; **peer tools are labeled external** in any agent's tool list.
- Each agent is **independent**: own container, own subdomain, same (identical) chat UI — deletable, restartable, monitorable on its own.

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
apps/zenod  apps/archus  apps/epaminon  apps/outbound  apps/nectary
                         (every agent: identity + its tools + optional config tab; shell is base-ui)
services/xmcp  services/reddit-mcp  services/mail-mcp   (upstream tool servers apps/outbound composes)
```
**Containers (Dokploy, side by side):**

| Container | Agent | Subdomain | Status |
|---|---|---|---|
| `zenod` | Zenod | app.zenod.dev | live |
| `archus` | Archus | archus.zenod.dev | live (rebuild) |
| `epaminon` | Epaminon | epaminon.zenod.dev | live (headless → +chat UI) |
| `outbound` | Outbound (X + Reddit + email) | outbound.zenod.dev | partial (X tools live → +Reddit +Mail) |
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
- **#147** Mail → folds into the **Outbound** agent (email is one of its tools).
- **#148** X migration → folds into the **Outbound** agent (X + Reddit + email composed internally), central-managed.

## Open questions — NOT yet specified (must close before/while building)

The agent **shape** is settled. These layers underneath are still single phrases above that
hide real decisions. We do not pretend they're answered.

**Unproven assumptions (need an experiment):**
- **Base/vault separation** — the engine is vault-coupled (`engine.answer()` hardwires vault
  + tasking + drive tools inline). Unproven until the **spike** (phase 1). *This is why it's first.*
- **Tools-as-injectable** — "agent = base + a tool list" is a goal, not yet true; same knot as
  the spike. Making tools a clean list the base loop discovers is the actual refactor.

**Underspecified design (need a one-page contract before relying on it):**
- **Central's contract** — token **broker** (mints per-repo scoped tokens on request) vs.
  **key distributor** (hands agents the private key)? LLM **proxy** (central metering + key
  rotation) vs. **key distribution**? This one fork decides whether isolation + metering are
  *real* or *aspirational*. Pick explicitly.
- **Mesh contract** — discovery (how an agent learns a peer's URL + tools), auth (today a
  shared `api_token` hack — needs real per-agent auth), scoping (does every agent see every
  peer's tools, or a curated subset?), recursion depth. Decide before wiring #145.
- **Isolation: enforced or policy?** "An agent only touches the repos its job needs" is today
  a *policy* (one GitHub App installed broadly; Archus got Zenod's creds copied), not an
  *enforced boundary*. Enforcing it requires Central to gate token issuance per-agent → ties
  to Central's contract above.

**Blindspots not yet placed in the architecture:**
- **Gateways** — Zenod's real UX is **WhatsApp**, not the web chat. Is a WhatsApp/Telegram
  number a **base capability** (any agent can have one) or Zenod-only? "The UI is the chat"
  silently ignores the channel that actually drives Zenod. Decide where gateways live.
- **New-agent creation flow** — "duplicate and extend" is still a manual ritual (hand-run
  Dokploy API + container-to-container secret copy, as Archus was). Needs a scaffold.
- **Base-change propagation** — shared package, but each agent is a separate deploy. "Change
  base → all change" needs a rebuild-and-redeploy-all step that doesn't exist yet (else: skew).
- **Cutover** needs WhatsApp/SQLite state migration (see caveats above).
