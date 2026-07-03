# Candidate A — Vercel Eve — DNF (infra-gated in this sandbox)

**Status:** DNF against test 1+ in this environment. **Not a defect verdict** — see kill criteria.

## Why DNF here
The acceptance harness's tests 1–5 require Eve running self-hosted per the `vercel-labs/steve`
pattern: **Postgres Workflow "world" + Docker sandbox + direct Anthropic**. This sandbox has:
- **no Docker daemon** (isolated; no host/SSH/docker access — per run constraints),
- **no Postgres**,
- and the durability dep is **version-incompatible on npm `latest`**.

Reaching test 1 would mean standing up that infra + hand-aligning a pre-release version
matrix — the ">~1 day fighting versions/incompatibilities" kill-trigger. Recorded DNF with
evidence, moved on, per the issue.

## Empirical version evidence (npm view, 2026-07-03)
```
eve                       latest = 0.19.0   beta = 0.6.0-beta.20
@workflow/world-postgres  latest = 4.2.0    # Eve/steve need the 5.0.0-beta.19 line; latest fails mid-run
workflow                  latest = 4.5.0
```
The `@workflow/world-postgres` `latest`↔required mismatch is the exact fragility the research doc §1 flagged, now confirmed against the live registry.

## What a real (non-sandbox) Eve run needs
1. A VPS with Docker + Postgres (mirror `github.com/vercel-labs/steve`, Ansible playbook).
2. Pin: `eve@0.19.x`, `@workflow/world-postgres@5.0.0-beta.x`, `workflow@4.5.x`, `ai@7.0.0-canary.x`.
3. Port the ephemeral-executor lane as one `agent/` dir; wire `search_memory` as an Eve tool/connection.
4. Keep the authority receipt OUTSIDE Eve (as candidate C does).
5. Run the identical harness (`../candidate-c-diy/src/harness.test.mjs` shape) against it.

## Verdict
Promote Eve only if, at its 1.0/GA on a real host, it clears all six tests with **less** ops
risk than candidate C. Today it does not clear even test 1 without infra we don't have, and its
durability layer is on a pinned beta.
