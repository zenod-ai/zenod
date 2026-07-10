# Epic 3.1 C-7 autonomous validation evidence

Code under test: `b8124bb4a14d3a665c4aae8593f07651251efa2c`

Environment: local Node demo servers on `127.0.0.1:8791` (hosted, three
tenants) and `127.0.0.1:8792` (single-tenant), each booted with a fresh empty
data directory. Browser checks used the Codex in-app browser against the real
`apps/web` production build.

## Automated proof

```sh
npm run typecheck -w @zenod/mcp-chassis
npm run build -w @zenod/mcp-chassis
npm run typecheck -w web
npm run build -w web
npm run test -w @zenod/mcp-chassis
git diff --check
```

Result: pass. The chassis suite contains 43 tests, including
`src/demo.e2e.test.ts`, which provisions three tenants, initializes MCP and
writes/reads an isolated marker for each tenant, verifies session/API scoping,
rejects a mutated token, rotates T2, and boots the same demo in env-seeded
single-tenant mode.

## Live browser proof

- T1, T2, and T3 each logged into the real console and displayed only their
  tenant name, tenant id, and usage count.
- A T1 navigation to `/?tenant=tenant-2` remained scoped to T1.
- T2 token rotation was confirmed through the console dialog. The original
  token returned `401`, the rotated token returned `200`, and a mutated token
  returned `401` on MCP initialize.
- The env-seeded self-host tenant logged into the same console image and MCP
  initialize returned `200`.
- The first pass caught a blank-panel regression after capability filtering.
  Commit `b8124bb` controls the selected tab so the first visible chassis panel
  renders after login.

Screenshots:

- `tenant-one.png`
- `tenant-two.png`
- `tenant-three.png`
- `self-host.png`

Residual integration gate: pair this demo proof with the Epic 3.2 Zenod pilot
browser proof against the same chassis API before the human API-freeze gate.
