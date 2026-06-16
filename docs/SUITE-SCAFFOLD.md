# Suite Scaffold — Target Structure

The clean end-state the scaffold refactor is moving toward. Every step must land
*toward* this picture, tested and revertible. If a step doesn't fit this map, we
don't take it.

## Principle

Separate the **reusable substrate** from **per-agent specifics**. Few, well-bounded
packages. An agent is a *thin composition* of shared packages + its own tools and
identity — **never a fork**.

## Packages: 3 shared + thin agent apps

### Shared (the scaffold)

**1. `zenod` (core library)** — all reusable domain logic. No HTTP, no UI. Pure
logic, organized in clear internal modules:
- `engine/` — the LLM agent loop, chat, tool-calling
- `vault/` — git-backed memory
- `llm/` — provider adapters
- `connections/` — credentials/identity: GitHub App auth, token minting, per-repo
  installation resolution, Drive, X. (This is where today's `githubApp.ts` belongs,
  as a clear module — not loose at the package root.)

**2. `@zenod/server` (server shell)** — the reusable Hono app: HTTP routes, MCP
server mounting, settings store, auth middleware, the connections REST endpoints,
health. **Parameterized by an agent config** (identity, system prompt, tools, tab
manifest). Zenod and Archus both instantiate the *same* shell with different config.

**3. `@zenod/ui` (UI kit)** — the React shell: tabs (Chat, Connections/Integrations,
Costs), shared components, login. Driven by a per-agent tab manifest.

### Per-agent (thin apps — composition + config only)

- `apps/zenod` — vault/memory tools + identity + tabs (Vault, Transcription) + Dockerfile + domain
- `apps/archus` — backlog tools + identity + Backlog tab + Dockerfile + domain
- `apps/mail` — email tools + identity + Dockerfile + domain
- (existing, unchanged: `apps/site` marketing; `services/x-mcp` vendored island)

## Boundary rules (what keeps it clean)

- **core** = pure logic. No `hono`, no `react`, no agent-specific names.
- **server** = HTTP/MCP shell. No agent-specifics hardcoded; everything comes via config.
- **ui** = presentation. No business logic.
- **agent apps** = composition + config. No copied shell code, ever.

If you can't say which of these a file belongs to, the boundary is wrong.

## Execution order (clean slices, each tested + revertible)

1. ✅ Decouple connections from the concrete `Settings` (interface). *(done)*
2. ✅ Connections into `core`. → **tidy into `core/src/connections/` module** *(next, trivial)*
3. **Parameterize `@zenod/server` into a reusable shell** — the key step. Zenod becomes its first config. *(the meaty one)*
4. Extract `@zenod/ui` from `apps/web`.
5. `apps/zenod` = thin composition on the shell (proves it; Zenod still works).
6. `apps/archus` = second composition → Archus exists, scaffold validated.

## Why this is robust, not fragile

- **Three** shared packages with single, obvious responsibilities — not a swarm of tiny ones.
- TypeScript + the test suite gate **every** step; each slice is behavior-identical and revertible at a git checkpoint.
- Agents are **config, not forks** — so adding Archus or Mail cannot rot the shared code.
- Deploy stays per-agent (each app its own Dockerfile), so one agent's deploy can never break another.
