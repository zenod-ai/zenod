# Research → Recommendation: is the suite the right shape?

Tool naming note: this research note predates the v4 public contract. Use
[behavioral-intent-patterns-and-chat-test-strategy-v4.md](./behavioral-intent-patterns-and-chat-test-strategy-v4.md)
as canonical for public tool names and output schemas.

**Question (Jordi):** are we building the wrong shape? Resolve Central, the mesh, and the
"Council" — with reference to how real multi-agent systems are built, not just my opinion.

**Short answer: the shape is right.** Your two instincts — "the mesh is *just tools*" and
"maybe you talk to a *Council* that has everyone's tools" — are the two canonical patterns in
the field. We're not inventing; we're landing on what LangGraph, OpenAI, Google, and
Anthropic all converged on. Below: the patterns, then a decision for each open question.

## What the field actually does

**Two protocols, two jobs (now an industry split):**
- **MCP = agent → tools.** Standard way an agent calls tools/data. Stateless, structured.
- **A2A = agent → agent.** Standard way agents *delegate to each other*; each agent publishes
  an **Agent Card** (a JSON doc at a well-known path) listing its name, URL, skills, auth.
- Key: *"MCP is about agents using capabilities; A2A is about agents partnering on tasks."*
  An A2A agent **can expose its skills as MCP tools** for simple, tool-like invocation — which
  is exactly your "a peer agent is just more tools" framing. For our scale that's enough; we
  don't need full stateful A2A yet. [a2a-and-mcp]

**Two orchestration patterns — this is the Council question:**
- **Manager / "agents as tools" (orchestrator):** one agent keeps the conversation and calls
  specialist agents *as tools*; each returns a result, the manager stays in control and talks
  to the user. **= your Council.** [openai-agents]
- **Handoffs / swarm (peer mesh):** no central coordinator; agents hand control to each other
  directly. Faster, but harder to reason about. [openai-agents][langgraph-swarm]

**The field's verdict on which to start with:** *supervisor/manager first.* It's "easier to
reason about, one routing node, every decision visible in traces, more accurate." Flat
swarm/all-to-all mesh scales badly (N² connections, tool-list bloat, hard to debug). For 3–5
agent roles, start with a flat supervisor. [langgraph-supervisor][augment-swarm-vs-supervisor]

**Anthropic's own system** is orchestrator-worker: a lead agent plans, calls subagents,
synthesizes. Two lessons that matter for us: (1) *multi-agent only wins when work decomposes
into independent parallel threads* — and it costs ~15× the tokens; (2) each subagent needs a
crisp contract (objective, output format, boundaries) or it drifts. [anthropic-multiagent]

## Recommendation (per open question)

### Central → **convention now, service later.** (Your lean is correct.)
- **Now (self-host, single-tenant):** Central is **not a service** — it's a **shared mounted
  volume + a registry-by-convention**. Creds live at an agreed path (set once, all agents read
  them). On startup each agent **writes its Agent Card** to an agreed path: `name`, MCP URL,
  tools, token. Discovery is automatic because the *location* is the contract. This is exactly
  the industry "Agent Card at a well-known location" pattern, realized as a file/dir. No
  functionality to build, nothing to keep running.
- **Honest caveat:** a shared creds volume does **not enforce isolation** — every agent *can*
  read every cred. That's fine when you own all the agents (self-host). The moment you go
  **multi-tenant / hosted** (see HOSTED-PLAN), Central must become a small **token-broker
  service** that mints per-agent scoped creds. So: *start as convention; upgrade to a service
  only when isolation must be enforced, not before.*

### Mesh → **keep your "just tools," but make the Council the hub (supervisor), not all-to-all.**
- Every agent stays an **MCP server exposing its tools** — correct, "just tools."
- **Do NOT wire every agent to every other agent** (that's the swarm the field warns against:
  N² edges, bloated tool lists, undebuggable). 
- Instead: the **Council is the hub.** Agents are spokes that expose tools; the Council
  composes them. Add a *direct* peer edge only when one is concretely, frequently needed
  (e.g. Zenod-the-librarian filing into Archus) — deliberate and few, never blanket.

### The Council → **yes, build it — and it's just another agent (no new shape).**
- The Council = **base + a tool list + identity** — the same uniform shape as everyone else.
  Its identity is "you can do everything"; its tools are the other agents.
- **Crucial design choice — agents-as-tools, not flattened union.** The Council should NOT
  hold all ~40 leaf tools flat (that bloats context and confuses routing). It holds **one
  delegation tool per agent**: `ask_brain(task)`, `archus(task)`, `outbound(task)`,
  `epaminon(task)`, … Each delegates to that agent's own LLM+tools and returns a result; the
  Council synthesizes and keeps talking to you. ~6 tools, not 40. This is the manager pattern,
  and it also resolves the earlier "tool-list scoping/bloat" worry.
- **Two access modes, both real:** talk to **one agent** (focused, its own tools) **or** the
  **Council** (one chat, delegates to everyone). Exactly what you described.
- **Don't over-engineer it.** Anthropic's 15×-token / parallel-subagent fan-out is for
  *parallel research*. The Council here is cheap: one LLM, one delegation at a time, unifying
  *access*. Keep it sequential and simple; reach for parallel fan-out only if a task genuinely
  splits into independent threads (that's already what Epaminon does for code).

### Gateways → **channels into one engine (settled).**
- WhatsApp / web / Telegram are equal front-doors to the same agent engine. A base capability;
  any agent can expose any channel. No privileged UX.

## Round 2 — the Council owns the UX; agents are headless MCP servers (DECIDED)

Jordi's refinement, which collapses the biggest remaining mess (per-agent web services):

- **The Council is the one conversational front-end.** WhatsApp, Telegram, and web **all bind
  to the Council** — not to individual agents. One front door to the whole suite.
- **The Council is always present — even with one agent.** "UniAgent" is not a special case;
  it's **Council + 1 agent**. You talk to Z0 *through* the Council, transparently. No separate
  "single agent chats by itself" path — uniformity preserved.
- **Agents are headless MCP servers.** No per-agent web chat. Reached two ways: (a)
  *conversationally* via the Council (it delegates with `ask_brain(task)` etc.); (b)
  *machine-to-machine* directly over authenticated MCP — a peer agent uses Z0's memory tools
  without the Council in the loop.
- **One human UI: the Council's.** Each agent contributes only its **config panel** (Z0 →
  Vault; others → cred panels), mounted into the Council UI from the registry. The whole suite
  = **one Council UI + N headless MCP servers.** This is the answer to "all these web services
  is weird" — yes, there's just one.
- **"Talk to one agent, focused"** survives as a **Council mode** (pin the conversation to a
  single agent's delegation tool), not a seventh web service.

Why this is *more* uniform, not less:
- **"Change the UI → everyone"** is now trivially true — there is exactly **one** UI.
- The **config-tab** question resolves: panels live in the one Council UI, contributed per agent.
- Matches the field exactly: in the supervisor pattern, workers are **not** separately
  user-facing — they're called as tools. Jordi arrived at it independently.

**Honest caveats (planned, not surprises):**
- The **Council is the single human entry point** — if it's down, no chat (agents still work
  machine-to-machine). Acceptable; one healthy front-end beats seven.
- **Migration:** Z0 today *is* c1.zenod.dev and *holds the WhatsApp session*. In this model the
  **Council** takes the gateways + the main domain; Z0 becomes a headless MCP server behind it.
  The WhatsApp number moves Z0 → Council at cutover. One-time, plannable.

**Updated container picture:** `council` (the UI + chat + gateways + delegation) at the main
domain; each agent (`zenod`, `archus`, `epaminon`, `outbound`, `nectary`) a headless MCP
server at its subdomain (MCP endpoint + health, no human chat). Central stays the shared
volume + registry.

## Round 3 — independence & configuration (the plug-and-play question)

**The stuck point:** if the UI lives in the Council, how do you configure a *standalone* agent
(Z0 alone needs its vault set) without shipping the Council? Does "needs config" force "ship
with the Council"?

**Resolution: config is data the AGENT owns; the UI is an optional editor.** Don't conflate them.
- Every agent owns its **config as data + a config surface** (read from env / a file in its
  volume / a small get/set API). The vault repo is *Z0's* config, stored in *Z0's* volume.
- **Three ways to write that config, all hitting the same surface the agent owns:**
  1. **Env / config file** at startup (`VAULT_REPO=…`) — the pure-headless, zero-UI path.
  2. **The agent's own config API** (get/set) — configure via CLI/API even with no UI.
  3. **The Council UI** — a *remote editor* that calls the agent's config API. The Council does
     not *own* the config; it's a pretty front-end over the agent's own surface.
- So **"needs configuration" never means "needs a bundled UI."** A headless agent is fully
  configurable by #1/#2. The Council UI (#3) is sugar.

**Dependency direction is symmetric — true plug-and-play, no hard requirement either way:**
- **Z0 alone:** ✅ pure MCP server, configured by env/file/API, no UI. Callable by anyone
  authenticated. Depends on nothing.
- **Council alone:** ✅ runs; just has no agents to delegate to yet.
- **Council + Z0:** the Council *wraps* Z0 — gives it a UI (remote editor over Z0's config API),
  orchestration, and reach to/from other agents. Remove the wrapper → Z0 still runs.
- → You do **not** ship Z0 with the Council as a hard dependency. The Council is the **product
  wrapper** (consolidated UI + orchestration); the agents are independently-installable
  capabilities. *(This is the Excel-vs-Office independence Jordi has wanted from the start.)*

**Where the config *form* comes from (so agents stay headless):** each agent **declares a config
schema** in its Agent Card (e.g. `vault_repo: string`, `vault_branch: string`). The Council
**auto-renders a form** from that schema → **zero UI code in the agent** for the common case
(paste-these-creds). An agent that needs a richer panel (Z0's vault browser) *may* ship a panel
the Council mounts — the exception — but the **schema + API stay the source of truth**, so
headless configuration always works. The shared-volume convention makes this trivial: config
lives at an agreed path; write the file → the agent reads it (headless), or the Council edits
the same file (wrapped).

## Round 4 — the Console: same UI always; uni = direct bypass, multi = council (THE LANDING)

The correction to Round 3: a *normal install* always has a UI. "Headless, no UI" is only the
secondary integration mode, not what a person installs. Jordi's framing is the resolution — the
shared service is not scary "Council baggage," it's the **Console**.

**The Console = the shared UI + OAuth/auth + connections + chat front-end + gateways + registry.**
Always present. **Always the same UI.** "Council" is just *one behavior* of it (multi-agent
routing), not a separate deployable you're forced into. (The Console subsumes what we earlier
called "Central": auth/connections/registry now live here, user-facing; a shared volume is just
its storage.)

**You always install the same thing: the Console + the agent(s) you enable. One URL. Full UI.**

**Same UI, two chat wirings — the only thing that changes:**
- **Uni mode (one agent, e.g. Z0):** the Console wires its chat **straight to that agent's chat
  endpoint** — *bypass*. Direct, exactly like today's WhatsApp→Z0. The council router is
  **dormant / transparent pass-through** — no orchestration overhead, **no baggage.**
- **Multi mode (>1 agent):** the Console wires its chat to the **Council router**, which delegates
  (agents-as-tools). Same UI underneath.
- The user never sees the difference; it's one internal wire (chat → agent vs chat → council).

**An agent therefore exposes two surfaces** (no UI of its own):
1. an **MCP tool server** (for machine-to-machine + for the council to call), and
2. a **chat endpoint** (LLM + its own tools) — the target the Console bypasses to (uni) or the
   council delegates to (multi).
Plus it declares a **config schema** and owns its config/data.

**Two run modes from ONE artifact:**
- **Product mode (normal):** Console + agent(s) → one URL, full UI (OAuth, vault config, chat,
  WhatsApp). Even with a single agent. This is what a normal person installs on their VPS.
- **Bare mode (integration):** the agent container alone as a pure MCP server, env-configured,
  no UI — when you only want its tools plugged into something else.

**What this means for the build (no abstraction left):**
> **The Console = today's monolithic Z0 shell** (UI + chat loop + auth + OAuth + connections +
> WhatsApp/Telegram gateways) **minus the vault/tools.**
> **An agent = the capability** (tools + chat endpoint + config schema) — what Z0's vault logic
> becomes.

So building the suite **is** the base/vault split: pull today's Z0 monolith into **Console (shared
shell)** + **Z0 (vault capability)**. The long-discussed "base" *is the Console*. The spike proves
exactly this split — it is no longer an abstract unknown but a concrete refactor of the current code.

## Round 5 — install / enable / deploy + connections (the lived experience)

**Product vision:** a person has a VPS with Dokploy/Coolify and runs this **containerized personal
agent suite** as their long-term, always-on baseline. They plug new capabilities in via MCP (the
"bus"). The first/baseline citizen is the **memory service = Z0.**

**Decisions:**
- **One suite, one monorepo.** All agents ship together — like installing Office even if you only
  want Word. No separate per-agent repos for now (may split later). *What the repo contains barely
  matters; what matters is the **deployment** — which containers run.*
- **Enable, not install.** Everything is "always there." You **enable** an agent, which means three
  things at once: (1) its **container is deployed/running**, (2) its **tools are registered** into
  the chat, (3) its **config panel** appears in the Console.
- **Deployment model v1: run all, toggle on/off.** Do **not** build deploy-on-demand yet (too much
  complexity for v1). All containers run by default; the Console toggles them on/off. A bit
  wasteful — acceptable for now; optimize to on-demand deploy later if needed.
- **The Console gets an on/off control surface** — a real part of the UX: which agents are enabled.
  *This is the first thing to build + test: register agents on/off and watch tools + config panels
  appear/disappear.*
- **Connections are shared; config is per-agent.** The "Vault tab" is really **"connect a GitHub
  repo."** GitHub OAuth, model keys, X creds, Drive, etc. live **once** in the Console's
  **Connections** center (connect once). Each enabled agent then declares a thin config: *which
  connected resource is mine* — Z0: "this repo is my vault"; Archus: "these repos are the backlog."
  So a per-agent panel is a small selector over shared connections, **not** a bespoke auth per agent.

## Net verdict
**The shape is right and now matches the field.** Two sharpenings, no pivot:
1. **The Council (supervisor) is the hub *and* the only human UI** — gateways bind to it, agents
   are headless MCP servers it delegates to (and that talk to each other directly over MCP).
2. **Central = convention** (shared creds volume + Agent-Card registry), upgrading to a
   token-broker service only at the hosted/multi-tenant step.
Everything already closed (agent shape = base + tools + identity, base-as-dependency,
group-by-job, gateways) stays closed; the config tab simply moves into the Council UI.

## Sources
- [augment-swarm-vs-supervisor] https://www.augmentcode.com/guides/swarm-vs-supervisor
- [langgraph-supervisor] https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture
- [langgraph-swarm] https://dev.to/jose_gurusup_dev/agent-orchestration-patterns-swarm-vs-mesh-vs-hierarchical-vs-pipeline-b40
- [openai-agents] https://openai.github.io/openai-agents-python/multi_agent/
- [openai-manager-handoffs] https://team400.ai/blog/2026-04-openai-agent-orchestration-handoffs-guide
- [a2a-and-mcp] https://a2a-protocol.org/latest/topics/a2a-and-mcp/
- [mcp-gateway-registry] https://github.com/agentic-community/mcp-gateway-registry
- [anthropic-multiagent] https://www.anthropic.com/engineering/multi-agent-research-system
