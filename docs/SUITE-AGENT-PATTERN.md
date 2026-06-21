# Suite Agent Pattern — the as-built handoff

How to bring a new suite agent online (Epaminon, the Callistheness agent, …). This is the
**proven** pattern, showcased by **Zenod** (memory) and **Archus** (backlog). It is the
*as-built* companion to the full target contract in [SUITE-SCAFFOLD.md](./SUITE-SCAFFOLD.md) —
build to this; if you must deviate, say so explicitly.

## The shape in one line

> **One Console** (public — UI + chat + auth/connections + gateways + the MCP front door)
> **delegates to N headless agents** (internal-only; each = the shared base + its tools + a
> chat brain + a config schema + an optional settings tab). One image; `AGENT=<name>` picks
> the persona. You **enable** an agent (mint+push a token), you don't install it.

## Invariants (do not break these)

1. **One public front door.** Only the Console has a public domain. Agents are reachable only
   on the internal docker network (`http://zenod-<name>:8080`). The user gets one URL.
2. **Same image, `AGENT` env selects the persona** (`packages/server/src/agent.ts` →
   `AgentDefinition` + `AGENTS` registry).
3. **Token origination.** The Console **mints** each agent's token and **pushes** it
   (`POST /api/provision`, one-shot, open only while `ZENOD_AWAIT_PROVISION=1` and not yet
   provisioned). The agent instantiates itself from the pushed token+config. Never retrieve a
   token; the enabler originates it. Re-enable reuses the stored token.
4. **The Console `/mcp` is a straight-through GATEWAY, not a chat.** It re-publishes the
   enabled agents' tools and forwards each call directly to the owner. **No Console LLM** ever
   runs for a tool call — the caller's LLM already chose; calling the tool just runs it. The
   Console's LLM is only for the human chat surfaces (web/WhatsApp/Telegram).
5. **Reads direct, writes through the guardian brain.** Each agent is the *librarian/guardian*
   of its domain. **Reads** can be deterministic and public (no LLM). **Writes + non-trivial
   reasoning** go through the agent's *own* brain (one LLM — the specialist's, never the
   Console's): the public tool is a **semantic intent entry line** (`create_issue`,
   `store_memory`, `ask_<name>`) → the brain interprets, applies its guidelines, and uses its
   **private** deterministic CRUD. The mechanical CRUD is never public.
6. **Per-agent tool names + qualified IDs.** The chat-brain tool is `chat_with_<name>`. Any
   external reference is fully qualified (`owner/repo#N`, never bare `#N`).
7. **Guidelines live in the persona** (the agent's system prompt), enforced by tool contracts —
   not loose prose. Each agent's "librarian rules" are explicit.

## Anatomy of an agent

- **`AgentDefinition`** (`agent.ts`): `name`, `displayName`, `tagline`, `persona` (the
  guidelines), capability flags (`vaultless?`, `backlog?`, …). Register it in `AGENTS`.
- **Capability tools** (private/deterministic): its domain CRUD (e.g. Zenod's vault writes,
  Archus's `editGithubIssue`/`createGithubIssue`). The brain wields these; they are NOT public.
- **Reads** (deterministic, may be public): e.g. `search_memory`, `get_memory`; for a backlog
  agent, list/query issues.
- **Chat brain**: `engine.chat` with the agent's tasking tools, exposed as `chat_with_<name>`.
- **Config schema**: what it needs (an LLM key always; its resource — a repo / a connection).

## Adding a new agent — checklist

1. **Define it** — `agent.ts`: add the `AgentDefinition` (+ persona/guidelines), register in
   `AGENTS`. Reference: `ZENOD_AGENT` (memory), `ARCHUS_AGENT` (backlog, vaultless).
2. **Give it tools** — its private domain CRUD + its reads + its chat brain. Mirror how
   `runtime.getEngine()` builds the engine per mode (vault / vaultless / backlog) and how
   `buildMcpServer` registers tools (`mcp.ts`).
3. **Config check** — what makes it "configured" (LLM key + its resource). Mirror the backlog
   agent's check in `runtime.getEngine`.
4. **Deploy unit** — `docker-compose.<name>.yml`: `AGENT=<name>`, `ZENOD_AWAIT_PROVISION=1`,
   internal-only (no public domain). Deploy via Dokploy push (no hand-run containers).
5. **Console catalog** — add to `SUITE_AGENTS` in `app.ts`: `internalBaseUrl`, `needsRepo` +
   `repoSetting`/`repoLabel` (if it owns a repo), and `peerTools` (its mesh delegation specs).
6. **Gateway tools** — add its public tools to `GATEWAY_TOOLS` in `meshGateway.ts`: **reads**
   route name-preserving to the owner's read tool; **writes** are named intents
   (`peerTool: "chat_with_<name>"` + an `intentPrefix`) routed to the brain. Add readable
   labels in `aisdk.ts` `toolLabel` so the chat activity line reads cleanly.
7. **Enable** — the Console Team tab mints the token, provisions, stores the peer; its tools
   come alive at the gateway. Repo (if any) is picked from the GitHub connection and is
   shown + re-pointable via "Manage".

## Reference implementations to copy

- **Zenod** — memory librarian. Public reads: `search_memory`, `get_memory`; brain:
  `ask_brain` / `store_memory`. Files: `ZENOD_AGENT` (agent.ts), vault engine path
  (engine.ts), `buildMcpServer` (mcp.ts).
- **Archus** — backlog guardian (vaultless + `backlog`). Public v4 tools include
  `request_backlog_action`, `run_issue`, typed reads/resolvers, and `ask_archus`; private CRUD =
  `createGithubIssue`/`editGithubIssue` (`connections/github.ts`); guidelines in
  `ARCHUS_AGENT.persona`. In the execution-ticket protocol, Archus is also the sole owner
  of central `type:execution` tickets: it mints `exec:queued`, writes `exec:approved`, and
  reflects Epaminon's reported outcomes onto the work ticket.
- **Epaminon** — execution guardian (vaultless + `executor`). Human-facing requests route to
  `chat_with_epaminon`, but the durable queue is the Archus-minted execution ticket, not a
  direct backlog label. Epaminon receives dispatched execution tickets, launches the runner,
  reports transition facts back to Archus, and handles approval/ship/blocker flow. Legacy
  `status:queued` work-issue labels may still exist while the runner is being repointed, but
  they are compatibility mechanics, not the target ownership model.

## Anti-patterns (don't)

- ❌ Give an agent its own public domain/UI. It's internal; the Console is the front door.
- ❌ Expose a deterministic *write* publicly on a guardian agent — route writes through its
  brain + guidelines; keep mechanical CRUD private.
- ❌ Run the Console's LLM on a gateway tool call (that's the double-LLM we removed).
- ❌ Publish internal Archus↔Epaminon lane tools (`enqueue_execution`, `approve_execution`,
  `apply_execution_event`) on the public Console gateway. Those are identity-gated
  internal protocol calls.
- ❌ Bare `#N` references. Always `owner/repo#N`.
- ❌ Hand-run / `docker exec` services on the VPS. Dokploy push-deploy only.
