# Console Connector Proxy Contract

Status: target contract for suite-v2 connector access from fan-out workers.

## Problem

The Console already centralizes user authentication and republishes enabled suite-agent tools
through one MCP gateway. That is true for agents, not yet for generic user connectors such as
Gmail, Drive, Calendar, Notion, or future app connectors.

Workers should not receive raw connector credentials or every low-level connector action. They
should receive a curated tool surface from the Console that preserves the same guardian model as
the agent suite.

## Invariant

One worker credential reaches one backend: the Console `/mcp` gateway.

The Console decides which connector capabilities are exposed. Raw secrets never leave Console
storage. Destructive or irreversible connector actions must route through the responsible
guardian agent, not directly to a worker.

## Capability Classes

### Deterministic Reads

Safe read-only connector operations may be exposed directly when they are bounded and auditable.

Examples:

- List recent files in a Drive inbox.
- Read metadata for a known Drive file.
- Search calendar availability.
- Read a known document exported as text.

Rules:

- No raw OAuth tokens in tool output.
- Return source IDs/URLs where useful.
- Bound result size.
- Prefer structured output.

### Semantic Writes

Writes that require judgment or can reshape user-owned state route through a guardian brain.

Examples:

- File connector content into memory -> Zenod.
- Create or modify backlog work -> Archus.
- Send email/post/publish -> Outbound.
- Notify Jordi -> Phylax.

Rules:

- The public tool name carries intent.
- The owner agent's `chat_with_<agent>` brain interprets the request.
- Mechanical connector CRUD remains private to the owner.
- Human confirmation gates remain owned by the guardian, not by the worker prompt.

### Internal Protocol Lanes

Agent-to-agent protocol tools are never exposed on the public Console gateway.

Examples:

- `enqueue_execution`
- `approve_execution`
- `apply_execution_event`
- `deliver_to_principal` once it becomes a true internal mesh primitive

Rules:

- Identity-gated by counterparty.
- Not advertised to worker MCP clients.
- Covered by gateway contract tests.

## Initial Worker Surface

When the Console has matching connections and agents enabled, a worker may see:

- Memory: `ask_zenod`, `search_memory`, `get_memory`, `store_memory`
- Backlog: `ask_archus`, `create_issue`, `edit_issue`, `close_issue`
- Execution: `execution_status`, `run_ticket`, `report_outcome`
- Outbound: `ask_outbound`, `post_tweet`, `post_reddit`, `send_email`
- Notifications: `ask_phylax`, `raise_event`

Connector-native read tools should be added only after they are explicitly classified as
deterministic reads and added to the gateway contract tests.

## Implementation Checklist

1. Inventory each connector's current auth storage and low-level tool list.
2. Classify each low-level operation as deterministic read, semantic write, or internal-only.
3. Add a Console-owned wrapper for deterministic reads.
4. Add or reuse a guardian-agent semantic tool for writes.
5. Add gateway tests proving the exposed surface and denied internal/raw tools.
6. Add audit output: source URL/ID, owning connector, and correlation id where available.

## Non-goals

- The Console is not a blind outbound MCP tunnel.
- Workers do not receive OAuth refresh tokens.
- Worker prompts are not the safety boundary for sends, deletes, or user interruptions.
