# Zenod Suite — Target Architecture (THE CONTRACT)

This is the single source of truth. We build **to** it. A decision here changes only by a
deliberate edit to this file — never silent drift. Migration is **Option B** (build in
parallel, prove, cut over); the live system is never mutated destructively.

The full reasoning behind every decision (with external research + the round-by-round
discussion) lives in [RESEARCH-AGENT-ARCHITECTURE.md](./RESEARCH-AGENT-ARCHITECTURE.md).

---

## The product (the vision)

A person has a VPS with **Dokploy / Coolify** and runs this **containerized personal agent
suite** as their long-term, always-on baseline. **One URL** gives them the whole thing. They
plug new capabilities in over **MCP** (the bus). The first/baseline citizen is the **memory
service — Zenod (Z0)**.

It is **one suite, one monorepo** — all agents ship together, like installing Office even if
you only want Word. You don't *install* an agent; you **enable** it.

## The shape in one line

> **One Console (the UI + chat + auth/connections + gateways, always present) that delegates to
> N headless agents (each = base + tools + a chat endpoint + a config schema + one settings tab).
> The base is shared, so changing it changes everyone. Enable agents on/off; the chat is the UX.**

---

## THE CONSOLE — the one shared service (the product front-end)

The Console is **the whole UI and the shared backend in one** — one URL, always the same UI.
It owns:
- **the chat front-end** (the UX) and the **chat router**,
- **OAuth + connections** (the auth center you already built) and the **registry**,
- the **gateways** — **WhatsApp · Telegram · Web** all bind here (equal front-doors; no
  privileged channel),
- **Costs · login** and the **on/off control surface** (which agents are enabled).

It **subsumes what we earlier called "Central."** "Council" is **not a separate thing** — it's
just the Console's **multi-agent routing mode.**

**Same UI, two chat wirings** (the only thing that changes):
- **Uni mode (one agent enabled):** the chat is wired **straight to that agent's chat endpoint
  — bypass.** Direct, exactly like today's WhatsApp→Z0. The router is a transparent
  pass-through — **no orchestration baggage.**
- **Multi mode (more enabled):** the chat is wired to the **Council router**, which **delegates**
  to the enabled agents (**agents-as-tools**: one delegation tool per agent — `ask_zenod(task)`,
  `archus(task)`, … — not 40 flat leaf tools). "Talk to just one agent" survives as a Council
  **focus mode**, not a separate UI.

The user never sees the difference; it's one internal wire.

---

## Serving topology — human entry vs MCP endpoints (every agent is also infrastructure)

Two ways in, **independent of each other:**

**Human entry — the Console** (one URL, the main domain): UI + chat + gateways (WhatsApp /
Telegram / Web). For *you*.

**Machine entry — each agent is its own MCP server + its own token.** For *clients* (Codex,
Claude, Hermes, …). **This exists today** — Z0 is an MCP server you hand a token to — and the
refactor **generalizes it to every agent; it is not lost.** Every agent stays always-on
infrastructure: an MCP endpoint + token your other tools connect to.

**"4 enabled = how many URLs?" → one MCP endpoint per agent** (a subdomain per container — the
Dokploy-native shape):
```
https://zenod.zenod.dev/mcp      🔑 Z0's token
https://archus.zenod.dev/mcp     🔑 Archus's token
https://epaminon.zenod.dev/mcp   🔑 …
https://outbound.zenod.dev/mcp   🔑 …
```
Each is **independently connectable** — a client wires only the agent(s) it needs. **Pure-MCP
view: N enabled agents = N standalone MCP servers**, each with its own token. The Console UI is a
*separate* URL layered on top; it does not change the per-agent MCP picture.

**Optional aggregate gateway (additive, later):** the Console can *also* expose **one** MCP URL
(e.g. `mcp.zenod.dev`) fronting all enabled agents with **namespaced tools** (`zenod.*`,
`archus.*`) behind **one token** — for a client that wants the whole suite in one connection. The
MCP-gateway pattern; convenience on top of per-agent endpoints, not a replacement. **Start
per-agent** (matches today, preserves independence); add the gateway only if needed.

---

## AN AGENT — uniform, headless

Every agent is the **same shape**. No kinds, no exceptions.

```
agent = base + {its tools, optional internal MCP servers} + a chat endpoint + a config schema + one settings tab + identity/persona
```

- It exposes **two surfaces**: an **MCP tool server** (for the Console/Council to call, and for
  peer agents to call directly, authenticated) and a **chat endpoint** (an LLM + its own tools —
  the target the Console bypasses to in uni mode / the Council delegates to in multi mode).
- It has **no UI of its own** — the Console is the UI. It only **contributes one settings tab**
  (see below) via its config schema.
- **Group by JOB, not by MCP server.** An agent may compose **several MCP servers internally**
  (e.g. **Outbound** = X + Reddit + email) — invisible plumbing; externally one agent, one chat,
  one tool surface.
- **Two run modes from one artifact:** **product mode** (Console + agent → one URL, full UI) is
  the normal install; **bare mode** (the agent container alone as a headless MCP server,
  env-configured, no UI) is the integration path.

---

## The UI & tabs (resolved)

**It is literally the same web UI we already have.** Permanent areas: **the chat** (the UX) +
shared setup (**Connections · Costs · login**) + the **on/off** surface. On top of that:

- **Each ENABLED agent contributes exactly one *settings tab*** — where you manage *that
  agent's* settings. **Z0's tab is "Vault"** (Zenod's settings — the vault repo, transcription).
  Enable **Archus** → a **"Backlog"** tab (its GitHub repo selections). Enable **Epaminon** → an
  **"Executor"** tab. Etc.
- **Tabs are shown/hidden by what's enabled.** Not a different UI — the *same* UI, where an
  agent's tab appears only when it's on, and hides when off.
- These are **settings/config tabs, NOT content surfaces.** No inbox, no feed, no dashboard. You
  still *use* every agent through the **chat**; a tab is only for setup.
- A tab's contents = the agent's declared **config schema** (the Console auto-renders the form)
  + the shared **Connections**. Rich panels (e.g. a vault browser) are the exception; the
  schema/API stays the source of truth so **headless config always works**.

---

## Connections (shared) vs config (per-agent)

- **Connections are shared — connect ONCE.** GitHub OAuth, model/provider keys, Google Drive, X
  / Reddit creds live once in the Console's **Connections** center.
- **Config is per-agent — a thin selector.** Each agent declares *which connected resource is
  mine*: Z0 → "this repo is my vault"; Archus → "these repos are the backlog"; Outbound → "this
  X / Reddit / email account." So a per-agent tab is a small selector over shared connections —
  **not a bespoke auth per agent.** (Z0's "Vault tab" is really "connect a GitHub repo.")
- **Config is agent-owned DATA** (env / file in its volume / a get-set API). The Console UI is
  just an editor over it. Three write paths, same surface: env/file (headless), the agent's API,
  or the Console UI.

---

## Enable / on-off / deploy

- **Enable, not install.** Everything ships together; you **enable** an agent, which flips three
  things at once: (1) its **container runs**, (2) its **tools register** into the chat, (3) its
  **settings tab appears** in the Console.
- **Deployment v1: run all, toggle on/off.** Do **not** build deploy-on-demand yet (too much
  complexity for v1). All containers run by default; the Console toggles them on/off. A bit
  wasteful — acceptable now; optimize to on-demand later if needed.
- **First thing to build + test:** the on/off **registration loop** — enable an agent → its
  tools + settings tab appear; disable → they vanish.

---

## THE BASE — shared, identical in every agent

Code reuse, not a runtime. The base **is the Console shell** plus the agent loop:
- **`base-server`** — the agent loop (chat + tool-calling) + MCP server + connections-client.
  **No vault, no domain tools.**
- **`base-ui`** — the Console UI shell: chat + Connections · Costs · login + the dynamic
  settings-tab host + the on/off surface.

**The base is a shared dependency you import — not copied files.** One copy in the monorepo;
every agent imports it. **Change it once → rebuild → all agents get it.** A new agent =
scaffold a thin app (identity + tools + config schema). *Duplicate-and-extend to create;
shared-import so a base change propagates to all.*

---

## Mesh — agents-as-tools via the Console hub (not a swarm)

The mesh is just **agents using each other's tools.** The **Console/Council is the hub**; agents
are spokes that expose tools. **Do not wire every agent to every other** (the swarm the field
warns against: N² edges, tool bloat, undebuggable). Add a **direct** peer edge only where
concretely, frequently needed (e.g. Zenod filing into Archus). Peer tools are labeled by origin
(`archus.create_issue`). This is the field-standard **supervisor** pattern.

---

## The roster (all agents uniform)

| Agent | Job | Its tools (wired into its chat) | Settings tab | MCP endpoint | Status |
|---|---|---|---|---|---|
| **Zenod** | memory / librarian | search_vault, read_note, list_pages, search_chats, capture_note, propose/execute_vault_task | **Vault** | `zenod` | **LIVE** |
| **Archus** | backlog | query/service/digest_backlog, create/edit/label_issue, approve_queue/merge | **Backlog** | `archus` | **LIVE** (rebuild) |
| **Epaminon** | executor | drain queue, Codex fan-out, open PR, merge-on-green | **Executor** | `epaminon` | **LIVE** (headless) |
| **Outbound** | outbound comms: post + email | post_tweet, read_tweets, submit_post, read_subreddit, comment, send_email, search_email — *composed from 3 internal MCP servers (xmcp + reddit-mcp + email)* | **Accounts** | `outbound` | **partial** (X tools live → +Reddit +Mail) |
| **Nectary** | financing | (TBD) | **Financing** | `nectary` | **future** |

The **Console** is the product at the main domain (today: `app.zenod.dev`). Each agent's MCP
server is reachable internally (and optionally at its subdomain for external MCP use).

## Repos & containers

**One monorepo:**
```
packages/base-server   packages/base-ui          (the shared base / Console shell — every agent imports it)
apps/console                                      (the Console: UI + chat + auth/connections + gateways + router + on/off)
apps/zenod  apps/archus  apps/epaminon  apps/outbound  apps/nectary
                         (every agent: identity + its tools + its config schema; headless, no UI)
services/xmcp  services/reddit-mcp  services/mail-mcp   (upstream tool servers apps/outbound composes)
```

| Container | Role | URL | Status |
|---|---|---|---|
| `console` | the Console (UI + chat + auth + gateways + router) | main domain | planned (= today's Z0 shell minus vault) |
| `zenod` | memory agent (MCP + chat endpoint) | `zenod` (mcp) | live (to split) |
| `archus` | backlog agent | `archus` (mcp) | live (rebuild) |
| `epaminon` | executor agent | `epaminon` (mcp) | live (headless) |
| `outbound` | outbound agent (X + Reddit + email) | `outbound` (mcp) | partial |
| `nectary` | financing agent | `nectary` (mcp) | future |

v1: all containers run; the Console toggles them on/off.

---

## Migration — Option B (parallel → prove → cut over)

1. **Spike (FIRST):** split today's monolithic Z0 into **Console (shell — chat + MCP +
   connections + UI + gateways, NO vault, NO tools)** + **Zenod (the vault capability)**, running
   on `z2`. If it separates clean → proceed. If it fights → rethink before building. *Converts
   the one real unknown to fact.* **The "base" IS the Console — this is a concrete refactor of
   current code, not an abstraction.**
2. **Extract the base** (`base-server` vault-less loop + `base-ui` Console shell).
3. **Build Zenod-v2 = base + memory capability** → deploy to **z2.zenod.dev**, same vault data →
   **prove parity** (chat, vault, gateways, on/off registration). Live Zenod untouched.
4. **Rebuild Archus = base + backlog capability** (replaces today's throwaway prototype).
5. **Mesh + Council routing** (multi-agent mode in the Console).
6. **Cutover** — point the main domain → the Console-v2 stack, retire old.

**Honest cutover caveats (planned, not surprises):** Z0 holds state beyond the vault — the
**WhatsApp session**, conversation history, usage, oauth — in v1's SQLite volume. At cutover the
**Console** takes over the gateways + main domain; **the WhatsApp number moves Z0 → Console.**
Two Z0s cannot share one WhatsApp number (428), so v2 runs WhatsApp-disabled while proving, and
the session moves at cutover.

## Build sequence — capabilities come to life ONE AT A TIME (UI-first)

The proven core (vaultless Console + mesh) means we now grow the suite **inside the Console UI,
one capability at a time**. The driver is a **Team tab**; each agent enabled there brings its own
settings tab to life. **We bake Zenod in FULLY before moving to Archus** — no jumping ahead.

1. **The Team tab (the enable surface).** A new tab in the Console listing the suite's agents
   (Zenod, Archus, …) with an on/off toggle each. Enabling an agent does three things at once
   (the on/off contract): connects it (registry/mesh) → registers its delegation tool
   (`ask_<name>`) → **surfaces its settings tab** in the Console. Disabling reverses all three.
   This is the on/off control surface made visible, and the home where capabilities "come to life
   one by one." (Backs onto the registry — enabling should eventually be one-click, no token paste.)
2. **Zenod — fully baked (step 1).** Enable Zenod from the Team tab → the Console delegates to it
   (mesh ✓ done) **and its "Vault" settings tab appears in the Console** (a remote editor over
   Zenod's own config — it owns the data; the Console renders the tab from Zenod's config schema).
   *Done = toggling Zenod on/off adds/removes both `ask_zenod` and the Vault tab, and you can set
   Zenod's vault from that tab.* Zenod is the first capability that fully lives in the Console UI.
3. **Archus — next (only after Zenod is fully baked).** Enable Archus → `ask_archus` + its
   **"Backlog" settings tab** appear. Same pattern, second capability.
4. **Then the rest, one by one** (Nectary, …). Base extraction + cutover slot in around this; the
   UI-first capability ladder is the spine.

How this maps to the backlog: the Team tab + on/off is **#161** (made visible); rendering an
enabled agent's settings tab from its schema is **#160**; Zenod-as-capability is **#158**; Archus
is **#162** — re-sequenced so each capability is *fully* alive in the UI before the next starts.

## Ticket re-assessment

- **#140** shared auth → folds into the **Console** (auth/connections center).
- **#142** scaffold → **the spike + extract the base/Console** (phases 1–2).
- **#143** Nearchus deploy → today's Archus is a **throwaway prototype** (runs full Zenod);
  rebuild as base + backlog (phase 4).
- **#144** backlog tooling → the **backlog capability** in `apps/archus` (phase 4).
- **#145** mesh → the **Council routing** in the Console (phase 5).
- **#146** gate → stays (final check).
- **#147** Mail → folds into the **Outbound** agent (email is one of its tools).
- **#148** X migration → folds into the **Outbound** agent (X + Reddit + email composed internally).

---

## Open questions — what's NOT yet specified

The shape is **settled**. What remains:

- **The spike (#154) — PROVEN ✓ (2026-06-16).** The engine separates from the vault **cleanly**,
  with ~15 small, localized, backward-compatible edits (not a tangle): `createEngine`'s `repo` is
  now optional; vaultless mode gives a persona-only briefing, vault read-tools that report "no
  vault" (so a model tool-call can't crash), no task tools, and `assertVault()`-gated vault-only
  methods. A vaultless engine test boots + chats + gates vault ops; the full suite stays green
  (vault agents always pass a repo → byte-identical path). The **Console** (`AGENT=console`,
  vaultless) is **live on z2.zenod.dev** side by side with live Zenod — boots, serves the UI, and
  needs only an admin password + LLM key (no vault). *The load-bearing assumption is now fact.*
- **The mesh (#145) — PROVEN ✓ (2026-06-16).** Agents delegate over MCP. Vault read-tools are
  now capability-gated (a vaultless agent omits them); a generic `PeerTools` slot flows through
  the engine → aisdk, registering each configured peer as an `ask_<name>` tool. `callPeer`
  connects to a peer's MCP endpoint with a bearer token and calls `ask_brain`. Peers are
  configured in the **Connections** UI (name + MCP URL + write-only token). **Live on z2:** the
  vaultless Console answered a memory question by calling `ask_zenod` → Zenod researched its
  vault → the Console relayed the answer. *Cross-agent auth (the flagged unknown) is resolved
  for self-host: a per-agent bearer token pasted via the connections center — connect-once, the
  Central model. Enforced isolation / a token-broker remains for the hosted step.*
- **Token origination — DECIDED (2026-06-16).** The **enabler mints the token.** When the Console
  (c1) enables an agent, c1 **generates** that agent's token and **provisions** the agent with it
  (+ config: vault repo, the shared LLM key c1 holds) over the internal `dokploy-network`; the agent
  **instantiates itself** with the given token and goes live. c1 never *retrieves* a token — it
  *originates* it, so a **headless agent (no UI) needs no token-retrieval path.** This makes **c1
  the token authority — the real Central / token-broker** — resolving cross-agent auth *and* the
  enforced-isolation question in one move: every agent's credential comes *from* c1. Agents boot
  "un-provisioned" and idle until c1 provisions them (fits run-all-toggle: the container runs;
  enabling provisions + connects). *Supersedes "isolation is only policy" below for the self-host
  case — c1 now controls every agent's credential.*

  **New-stack topology (c1 / z1 / z2):** **z1** = live Zenod (`app.zenod.dev`) — production, never
  touched. **c1** = the Console (the UI), at `c1.zenod.dev`; it is what was temporarily at
  `z2.zenod.dev`. **z2** = the NEW Zenod — **headless** (no public UI), an internal MCP server that
  c1 loads over `dokploy-network`. **c1 → z2 only; never c1 → z1.** Keeps the new stack isolated
  from production.
- **Base-change propagation** is manual per-container until a rebuild-and-redeploy-all step exists
  (else: version skew).

## Decision log

Decisions were reached across Rounds 1–5 (recorded in
[RESEARCH-AGENT-ARCHITECTURE.md](./RESEARCH-AGENT-ARCHITECTURE.md)): agent shape · base as
shared dependency · group-by-job + internal MCP composition · the Council/supervisor pattern ·
Central-as-convention → service at hosted · the Console owns the UX · config is agent-owned data
/ UI is the editor · the Console (same UI always; uni=bypass, multi=council) · enable-not-install
/ run-all-toggle / shared connections / per-agent settings tabs.
