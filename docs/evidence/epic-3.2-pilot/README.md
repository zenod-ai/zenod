# Epic 3.2 Zenod Multi-Tenant Pilot Evidence

- Pilot commit: `fe4e6552d7b5257185324f025dba69bb5fbe8a98`
- Chassis/main base: `98ce0eafd5087044d73473c569c8faecae70d019`
- Worktree: `/Users/jordi/Documents/GitHub/wt-736-live`
- Branch: `codex/epic-3.2-live-pilot`
- Environment: local Node 22, production server entrypoint and built React bundle
- Browser: Codex in-app Browser, 1280x720 viewport captures

## Passed

- Root build: core, chassis, server, web, and site.
- Chassis: 53 tests, including the #780 public-SPA/protected-custom-route regression.
- Server: 63 files and 575 tests, no skips.
- Epic scripts: 25 tests covering the joint proof, migration, and cutover inventory.
- Anonymous `/` and its built JavaScript asset return 200; anonymous and unknown-token product APIs return 401.
- Three-tenant contract proof passes provisioning, one-time token custody, MCP initialization/tool listing, control-token non-escalation, bearer/session isolation, query spoofing, tampered-cookie rejection, tenant media roots, 32 SQLite WAL checks, and raw-token byte scanning.
- Real browser sessions for T1, T2, and T3 show only the owning tenant name, repository, ingest panel, and usage panel. A T2 tenant-id URL query under T3's session still renders T3.
- Self-host env-token mode serves the SPA, MCP, settings, and token login before and after process restart.
- Migration plan/apply/verify preserves the token hash and repo setting, uses `chassis-tenants.sqlite`, scrubs obsolete standalone auth rows with secure deletion, passes checksum/SQLite/git/registry checks, boots with the unchanged token, and leaves zero raw-token byte matches.
- D18 automated acceptance passes: one `ingest_memory` tool, provided transcript bypasses STT and receipts `provided`; absent transcript performs STT and receipts `performed`.

The machine-readable contract result is in `fe4e655-contract/summary.json`. Browser captures are in `fe4e655-browser/`.

## Browser Captures

| Tenant | Repo | Ingest | Usage |
|---|---|---|---|
| T1 | `tenant-1-vault.png` | `tenant-1-ingest.png` | `tenant-1-usage.png` |
| T2 | `tenant-2-vault.png` | `tenant-2-ingest.png` | `tenant-2-usage.png` |
| T3 | `tenant-3-vault.png` | `tenant-3-ingest.png` | `tenant-3-usage.png` |

Additional captures: `cross-tenant-url-spoof-rejected.png` and `self-host.png`.

The repository credentials used for browser rendering were distinct fake test strings. Clone failure is expected in those screenshots; repository ownership and tenant isolation are the asserted browser behavior.

## Remaining Gates

- Full-mode store/search marker proof and three real GitHub commit receipts require three disposable writable repositories plus a test LLM API key. Local GitHub authentication is available; no Anthropic, OpenAI, or OpenRouter test key is present.
- Stripe test-event proof remains gated on Stripe test authentication in Epic 3.1.
- Live tenant migration and legacy subdomain retirement require Jordi's explicit approvals. No production data, deployment, DNS, or tenant instance was changed.
