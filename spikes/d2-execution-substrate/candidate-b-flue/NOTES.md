# Candidate B — Flue (github.com/withastro/flue) — DNF (infra-gated + open question)

**Status:** DNF against test 1+ in this environment. **Not a defect verdict** — see kill criteria.

## Why DNF here
Flue's sub-agent model (`session.task()`) and MCP wiring (`connectMcpServer`) run on Node/Docker,
but the harness's **test 2 (crash-recovery from durable state)** is the load-bearing one, and Flue's
durable sessions are **Cloudflare-Durable-Objects-first**. Running durable sessions **off Cloudflare**
(a custom store / Durable Streams) is **Flue's key open question** — called out as such in the issue.

This sandbox has **no Cloudflare Workers / Durable Objects runtime** and no proven off-Cloudflare
durable store to point Flue at, so test 2 cannot be demonstrated here. Reaching it would mean
building and validating that custom durable store first — again the ">1 day" kill-trigger.

## Empirical version evidence (npm view, 2026-07-03)
```
flue              latest = 0.2.6     # pre-1.0, youngest of the three candidates
@withastro/flue   404 Not Found      # package is unscoped `flue`, not under the @withastro scope
```

## What a real (non-sandbox) Flue run needs
1. Either a Cloudflare Worker + Durable Objects deployment, **or** a proven custom durable-session
   store (Durable Streams / our own Postgres-backed store) — and a test that a mid-turn kill resumes.
2. Self-host via `--target node` or Docker for the agent loop.
3. Sub-agent via `session.task()`; Zenod via `connectMcpServer` pointed at the Console/Zenod gateway.
4. Keep the authority receipt OUTSIDE Flue (as candidate C does).
5. Run the identical harness against it — **test 2 is the make-or-break**, since off-Cloudflare
   durability is the unproven claim.

## Verdict
Flue is the youngest candidate and its single most important property for D-2 (durable crash-recovery
**off** Cloudflare) is its least-proven. Re-evaluate only after that store is demonstrated; until then
candidate C provides the same crash-recovery guarantee with running, tested code and no Cloudflare tie.
