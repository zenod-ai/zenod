# Research → Recommendation: is the suite the right shape?

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
  delegation tool per agent**: `ask_zenod(task)`, `archus(task)`, `outbound(task)`,
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
  *conversationally* via the Council (it delegates with `ask_zenod(task)` etc.); (b)
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
- **Migration:** Z0 today *is* app.zenod.dev and *holds the WhatsApp session*. In this model the
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
