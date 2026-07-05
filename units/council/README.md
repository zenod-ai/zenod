# The council guy — unit (EPIC 2.5 · ticket W-B)

> **RD-2 is OPEN.** The guy's name is undecided (recommendation: *Mentor*). Everywhere this folder
> says "council guy" / `council` a real name must be substituted once RD-2 is DECIDED. Every
> `<COUNCIL_NAME>` marker below is a name-substitution site. Do NOT invent a name here.

## What this unit is

The **chief of staff** guy of the Atomic Suite. He is the default route when no other name matches:
general asks land on him, he answers *done-with-receipt*, he files memory **through Zenod** over the
seam, and he **dispatches Epaminon** for execution. He is a *guy* (an agent), not an *island*.

He holds **unit tokens only** — Zenod, Archus, Epaminon — issued by the ring's keyring (law 6c). He
holds **no world keys** (no repo token, no outbound keys, no OAuth): those live in the vault and are
pulled only by the one authorized unit (law 6b). He contains **no channel/adapter code** — no
Baileys, no Telegram, no WhatsApp store. Conversation reaches him only as a seam MCP call from the
ring; his reply exits the same way.

## The laws he lives under (from EPIC-2.5-ATOMIC-UNITS.md)

- **Law 2 / RD-3:** he MAY dispatch another guy (Epaminon), but only as a **typed async dispatch** —
  ticket + completion event, never conversational. **Depth ≤ 1** (a guy he dispatches may not
  dispatch onward), and every dispatch ticket carries `origin_ticket_id` tracing to the request that
  caused it. Canonical chain: `ring → council (depth 0) → Epaminon (depth 1)`; Epaminon dispatches
  no one.
- **Law 6c:** provisioned via the keyring with per-unit bearer tokens; enable/disable enforced at the
  token.
- **Turn-preamble pattern:** each turn he reads his **standing directives from memory** (via Zenod
  over the seam) and prepends them to the turn — he does not carry a baked-in evolving persona;
  directives are data he re-reads, not code he ships.

## MCP surface

He exposes exactly one MCP server over streamable HTTP (`https://<council>.<host>/mcp`). See
[SEAM-SURFACE.md](./SEAM-SURFACE.md) for the exact tools **exposed** and **consumed**, with receipt
shapes conforming to [docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md).

## Status (be honest)

**BLUEPRINT, not built.** The council guy runs today as the fused `console` agent inside the shared
image (`packages/server`, `AGENT=console`); its brain is `packages/core/src/engine` +
`packages/server/src/{agent,mcp,taskingPolicy,runtime}.ts`. Physical extraction into this container
is **STAGED behind the RD-4 split trigger** (SEAM-SPEC v1 passes the tester on ≥2 units) — which has
NOT fired. This folder is the target shape and the file-level extraction map
([EXTRACTION-MAP.md](./EXTRACTION-MAP.md)); no fused code is moved this iteration, and the live
Console stays buildable.

## Build / run (target)

Reuses the root image, selected by env — no separate package. See
[docker-compose.council.yml](./docker-compose.council.yml). The blocker to a real boot is that the
agent roster (`packages/server/src/agent.ts`) has no `council` `AgentDefinition` yet — only `console`
(the fused brain). Adding a `COUNCIL_AGENT` (vaultless, peer-tool-only, turn-preamble) is the first
code step when the split trigger fires. Until then `AGENT=console` is what actually boots.
