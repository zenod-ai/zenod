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

## Net verdict
**The shape is right and now matches the field.** The only change research suggests is a
*sharpening*, not a pivot: **adopt the supervisor (Council) as the orchestration pattern**
instead of a flat peer mesh, and **realize "Central" as a convention (shared volume + Agent
Cards) that upgrades to a token-broker service only at the hosted/multi-tenant step.**
Everything already closed (agent shape, base-as-dependency, group-by-job, config tabs,
gateways) stays closed.

## Sources
- [augment-swarm-vs-supervisor] https://www.augmentcode.com/guides/swarm-vs-supervisor
- [langgraph-supervisor] https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture
- [langgraph-swarm] https://dev.to/jose_gurusup_dev/agent-orchestration-patterns-swarm-vs-mesh-vs-hierarchical-vs-pipeline-b40
- [openai-agents] https://openai.github.io/openai-agents-python/multi_agent/
- [openai-manager-handoffs] https://team400.ai/blog/2026-04-openai-agent-orchestration-handoffs-guide
- [a2a-and-mcp] https://a2a-protocol.org/latest/topics/a2a-and-mcp/
- [mcp-gateway-registry] https://github.com/agentic-community/mcp-gateway-registry
- [anthropic-multiagent] https://www.anthropic.com/engineering/multi-agent-research-system
