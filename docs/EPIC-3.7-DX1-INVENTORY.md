# Epic 3.7 DX-1 Inventory - 2.x Fleet Classification

Status: ready for DX-2 planning
Created: 2026-07-10
Last verified: 2026-07-10 02:10 CEST
Branch: `codex/epic37-dx1-inventory`
Base commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Environment: Alpha9 Dokploy VPS (`dokploy.polyqu.com`, Docker host via `hetzner_vps_1`)
Bound issue: https://github.com/zenod-ai/zenod/issues/714
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`

This artifact is sanitized. It contains no environment values, bearer tokens, API keys, or raw Dokploy git URLs. The source Dokploy snapshot contains at least one credential embedded in a git URL, so raw rows must not be copied into the repository.

## Evidence Inputs

| Evidence | Method | Result |
|---|---|---|
| `/tmp/zenod-dokploy-inventory-sanitized.json` | Existing local Dokploy API inventory | 48 total Dokploy rows; 34 rows in project `zenod` are inventoried below. |
| `/tmp/zenod-docker-inventory-sanitized.json` | Existing local Docker inspect inventory | 100 containers; joined by compose project/app name and service. |
| `/tmp/zenod-docker-stats.jsonl` | Existing local Docker stats snapshot | Used for live container names and memory presence; not copied wholesale. |
| `/tmp/zenod-docker-volumes.jsonl` | Existing local Docker volume list | 81 total volumes; 68 relevant Zenod/compose volumes; 63 mounted, 5 orphan candidates. |
| `ssh hetzner_vps_1 ... /etc/zenod-watchdog.env` | Read-only watchdog map | `zenod-watchdog.timer` enabled and active; watched rows mapped below. |
| Public probes | `curl -L -sS -o /dev/null -w ...` | Zenod, Callisthenes, and Ring public endpoint families reachable. |

Public probe receipts:

| Family | Probe | Result |
|---|---|---|
| Zenod standalone | `https://z-jordi-f2c7a6.zenod.dev/api/health` | HTTP 200, 0.322884s |
| Callisthenes | `https://c-callisthenestest-vn6wnb.zenod.dev/connect` | HTTP 200, 0.437985s |
| Ring suite | `https://r-ringtest20260709-8uiw3s.zenod.dev/api/health` | HTTP 200, 0.565790s |

## Classification Rules

| Classification | Meaning in this inventory |
|---|---|
| `canonical` | Named current platform/control-plane row, not a per-user 2.x retirement target by itself. Some canonical-current rows are not the final Epic 3.x target; final sweep is DX-7. |
| `live-paying` | Live customer instance with explicit Epic 2.3 evidence and watchdog registration. |
| `test` | Test, e2e, no-touch, cloud-test, or obviously disposable tenant by name/branch/evidence. |
| `dead` | Public endpoint or container is dead by current evidence. No rows are classified dead in this snapshot. |
| `duplicate` | Duplicate Dokploy row for the same tenant/domain, usually failed/error and not materialized as the active Docker compose project. |
| `record-only` | Dokploy row exists but no Docker container joined in this snapshot and no stronger canonical/live/test evidence controls it. |
| `unknown` | Ambiguous ownership or lifecycle; do not retire without Jordi/steward classification. |

## Summary

| Scope | Count | Notes |
|---|---:|---|
| Dokploy rows in project `zenod` | 34 | 2 application rows, 32 compose rows. |
| Running 2.x candidate rows | 16 | 1 live-paying, 13 test, 2 unknown. |
| Failed duplicate Dokploy rows | 4 | No active Docker containers for their compose projects. |
| Dead rows | 0 | No row is dead by health/container evidence. |
| Watchdog-mapped 2.x rows | 3 | `zenod-jordi-f2c7a6`, `callisthenes-callisthenestest-vn6wnb`, `ring-ringtest20260709-8uiw3s`. |
| Relevant volumes | 68 | 63 mounted to containers; 5 unmounted/orphan candidates. |

DX-2 can safely start with test rows only after snapshots are defined. Do not remove `live-paying` or `unknown` rows without the human gate in the spine.

## Dokploy Identifier Map

This map binds every same-name row to its opaque Dokploy identifier. It is the disambiguation source for review; DX-2 additionally binds domain IDs, containers, volumes, watchdog tokens, and an approved CSV digest and then reconciles all of them against live state before any stop.

| Kind | Row | Runtime App/Compose | Dokploy ID | Status |
|---|---|---|---|---|
| `application` | `zenod` | `zenod-uqe3bx` | `Cfs2myovKQhu6r6DcN8g-` | `done` |
| `application` | `zenod-site` | `zenod-site-zxvcqp` | `bSGHEi-7-i9VdjP3QQSDi` | `done` |
| `compose` | `callisthenes` | `compose-back-up-optical-transmitter-kqinqv` | `oN6m6iGwRkDgc0C0WYvbD` | `done` |
| `compose` | `archus` | `compose-override-online-interface-jfl3ny` | `cMOFbal1eP64frpBqPWkN` | `idle` |
| `compose` | `ring-jordiring-fkegkz` | `compose-quantify-open-source-pixel-siik6w` | `a5BbpChW5PKgXUJFZSUNo` | `done` |
| `compose` | `ring-ringe2emain202607092-lw5wat` | `compose-compress-cross-platform-circuit-ewdmj5` | `epsGDOO6tkTQ6i9B_HnRt` | `done` |
| `compose` | `tenant-testco` | `compose-override-auxiliary-hard-drive-bavq21` | `u8EwwHmyykYv1qbv2sPmP` | `done` |
| `compose` | `phylax` | `compose-index-auxiliary-panel-3empwt` | `uCoS_Zr0qKZyQHu4UDVjx` | `done` |
| `compose` | `outbound` | `compose-back-up-solid-state-interface-x933zj` | `m9lceZf789T5ML8jznm79` | `done` |
| `compose` | `epaminon` | `compose-calculate-cross-platform-capacitor-vkqk6x` | `x9WtBYq_vcUFPW2WADcQP` | `done` |
| `compose` | `c1` | `compose-parse-primary-transmitter-4r9o44` | `Lq8w9IQ0KTlHu0QPp9CQ7` | `done` |
| `compose` | `callisthenes-callisthenestest-vn6wnb` | `compose-synthesize-1080p-system-v1v7gx` | `87fpHWO3Qvf9xXrR-04Nn` | `done` |
| `compose` | `zenod-jordi-f2c7a6` | `compose-quantify-multi-byte-firewall-r3b7ka` | `xDxfVYs0_4M09naWuCl66` | `done` |
| `compose` | `zenod-jorditest-od45rm` | `compose-navigate-neural-bus-xiqw66` | `ciBRPRrxi65xgi9mc3zal` | `done` |
| `compose` | `zenod-cloud` | `compose-override-virtual-matrix-s9ua9g` | `17QoMFRgvmZ0Y2n19DINT` | `done` |
| `compose` | `ring-ringtest20260709-8uiw3s` | `compose-parse-mobile-port-nz5tru` | `qvxRcJxBvWqYp-AYPLS3t` | `done` |
| `compose` | `zenod-cloud-test` | `compose-hack-optical-driver-mu9tyb` | `wP2PWUnRL1VnKUMfwHDPj` | `done` |
| `compose` | `z2-zenod` | `compose-parse-cross-platform-capacitor-cf4xa8` | `j1xrAJJ5o7yq3bRH1iTau` | `done` |
| `compose` | `callisthenes-jordicallifresh33087-muhmxp` | `compose-reboot-neural-hard-drive-z8o9gy` | `NR_px8Ul2L2w_RaM4-DWe` | `done` |
| `compose` | `ring-jorditestring-0ce4bp` | `compose-reboot-cross-platform-application-yqru5e` | `SFLkR6HA_TZUXP9qEv4r6` | `error` |
| `compose` | `archus2` | `compose-reboot-cross-platform-array-bwps4g` | `vHEIfpjU0Xwi-V-UZRZsn` | `done` |
| `compose` | `callisthenes-jorditest2-qmapvn` | `compose-bypass-back-end-protocol-9guvht` | `e-YFn3suCCKIol9w3akW7` | `done` |
| `compose` | `ring-jordiring-fkegkz` | `compose-index-primary-alarm-k4vw2k` | `ksmrenJOsbUyHuS45tIcK` | `error` |
| `compose` | `zenod-jordizenodtest33-gmcxem` | `compose-program-cross-platform-monitor-g4f7e8` | `NDFqSn6r-YraEGSQ_KcJJ` | `done` |
| `compose` | `callisthenes-jordikalitest-godu15` | `compose-synthesize-primary-panel-9xgjg8` | `mifThmov_r3lO6GYr3gi2` | `done` |
| `compose` | `zenod-jordizenodtest33-gmcxem` | `compose-program-primary-hard-drive-p3psql` | `bfQI30e1AobdUhmoV5ETo` | `error` |
| `compose` | `zenod-jordizenodtest33-gmcxem` | `compose-parse-neural-panel-zdjqpz` | `af7VR4e4H-4HdfDS1xnG8` | `error` |
| `compose` | `zenod-jordizenodtest-ccnzay` | `compose-parse-online-array-y5wp4v` | `3nUSkSxl-6eWBCosCN5RD` | `done` |
| `compose` | `ring-ringcloudtest2026070-yfnwxy` | `compose-back-up-bluetooth-bandwidth-xht4be` | `gl-REbqCb5mIzVM7D_4DI` | `done` |
| `compose` | `zenod-jorditestzenod0000-4ptjqj` | `compose-synthesize-optical-panel-rpo4zh` | `YdOtLxxT1MVk0SYrVE7qO` | `done` |
| `compose` | `ring-ringnotouch20260709-wl3hhm` | `compose-quantify-redundant-protocol-15cwae` | `HL8JfN2zVmkuM5mhaCBQS` | `done` |
| `compose` | `ring-jorditestring-0ce4bp` | `compose-navigate-multi-byte-panel-t2b3ik` | `1xcTXFoe8xVjsih1LC5c9` | `done` |
| `compose` | `x-mcp` | `compose-program-bluetooth-protocol-e2xsfm` | `NYUUcRopSdjmfRGoEWzHL` | `done` |
| `compose` | `zenod-runner` | `compose-parse-redundant-bus-gwvpd9` | `OOozR35khVR5wJsHpUy9f` | `error` |

## Dokploy Project `zenod` Inventory

Columns:

- `containers` is the joined Docker count and state summary.
- `volumes` lists mounted `/data` or runner volumes by Docker volume name.
- `materialization` distinguishes active Docker reality from Dokploy records.

| Row | Kind | App/Compose | Status | Branch | Domains | Class | Containers | Volumes | Watchdog | Materialization / Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| `zenod` | application | `zenod-uqe3bx` | done | main | - | canonical | 1 running, 1 exited service task | `zenod-data` | no | Current named app row; no per-tenant domain in snapshot. |
| `zenod-site` | application | `zenod-site-zxvcqp` | done | main | `zenod.dev`, `ring.zenod.dev` | canonical | 1 running, 3 exited service tasks | - | no | Marketing/front-door app, not a 2.x tenant. |
| `c1` | compose | `compose-parse-primary-transmitter-4r9o44` | done | main | `c1.zenod.dev`, `z2.zenod.dev` | canonical | `zenod-console:running` | `compose-parse-primary-transmitter-4r9o44_zenod-console-data` | yes (`zenod-console`, URL `c1`) | Current core console row. |
| `z2-zenod` | compose | `compose-parse-cross-platform-capacitor-cf4xa8` | done | main | - | canonical | `zenod-z2:running` | `compose-parse-cross-platform-capacitor-cf4xa8_zenod-z2-data` | yes (`zenod-z2`, URL `z2`) | Current core Zenod row. |
| `phylax` | compose | `compose-index-auxiliary-panel-3empwt` | done | main | - | canonical | `zenod-phylax:running` | `compose-index-auxiliary-panel-3empwt_zenod-phylax-data` | yes | Current gateway row. |
| `epaminon` | compose | `compose-calculate-cross-platform-capacitor-vkqk6x` | done | main | - | canonical | `zenod-epaminon:running` | `compose-calculate-cross-platform-capacitor-vkqk6x_zenod-epaminon-data` | yes | Current named unit row. |
| `outbound` | compose | `compose-back-up-solid-state-interface-x933zj` | done | main | - | canonical | `zenod-outbound:running` | `compose-back-up-solid-state-interface-x933zj_zenod-outbound-data` | yes | Current outbound row. |
| `archus2` | compose | `compose-reboot-cross-platform-array-bwps4g` | done | main | - | canonical | `zenod-archus2:running` | `compose-reboot-cross-platform-array-bwps4g_zenod-archus2-data` | yes | Current named row in watchdog. |
| `callisthenes` | compose | `compose-back-up-optical-transmitter-kqinqv` | done | main | `callisthenes.zenod.dev` | canonical | none joined | - | no | Final-fleet unit domain exists, but no Docker container joined to this compose project in the snapshot; also `zenod-cloud-test` claims the same host on port 4242. Verify before changing. |
| `zenod-cloud` | compose | `compose-override-virtual-matrix-s9ua9g` | done | `codex/epic25-ring-cloud` | `admin.zenod.dev`, `cloud.zenod.dev`, `cloud-test.zenod.dev` | canonical | `compose-override-virtual-matrix-s9ua9g-webhook-1:running` | `compose-override-virtual-matrix-s9ua9g_cloud-data` | no | Control-plane row; source git URL is redacted here. |
| `zenod-cloud-test` | compose | `compose-hack-optical-driver-mu9tyb` | done | main | `cloud-test.zenod.dev`, `callisthenes.zenod.dev` | test | `compose-hack-optical-driver-mu9tyb-webhook-1:running` | `zenod-cloud-test_cloud-data` | no | Test control-plane row; domain overlap with canonical Callisthenes requires steward review before DNS changes. |
| `x-mcp` | compose | `compose-program-bluetooth-protocol-e2xsfm` | done | main | - | unknown | `x-mcp-postread:running`, `x-mcp-readonly:running` | - | no | Non-tenant MCP row; owner/lifecycle not established by this evidence. |
| `zenod-runner` | compose | `compose-parse-redundant-bus-gwvpd9` | error | main | - | unknown | `zenod-agent-runner:running` | `zenod-agent-codex-home`, `zenod-agent-gh`, `zenod-agent-work`, anonymous runner volume | yes (`zenod-agent-runner`) | Dokploy says error but Docker container is running; not a 2.x retirement target until owner confirms. |
| `archus` | compose | `compose-override-online-interface-jfl3ny` | idle | main | `archus.zenod.dev` | record-only | none joined | - | no | Idle Dokploy record with no container in snapshot. |
| `zenod-jordi-f2c7a6` | compose | `compose-quantify-multi-byte-firewall-r3b7ka` | done | main | `z-jordi-f2c7a6.zenod.dev` | live-paying | `zenod-jordi-f2c7a6:running` | `compose-quantify-multi-byte-firewall-r3b7ka_zenod-standalone-data` | yes | Customer #1 from Epic 2.3; public health 200. Snapshot and migration verification required before retirement. |
| `zenod-jorditest-od45rm` | compose | `compose-navigate-neural-bus-xiqw66` | done | main | `z-jorditest-od45rm.zenod.dev` | test | `zenod-jorditest-od45rm:running` | `compose-navigate-neural-bus-xiqw66_zenod-standalone-data` | no | Test slug by name. |
| `zenod-jorditestzenod0000-4ptjqj` | compose | `compose-synthesize-optical-panel-rpo4zh` | done | main | `z-jorditestzenod0000-4ptjqj.zenod.dev` | test | `zenod-jorditestzenod0000-4ptjqj:running` | `compose-synthesize-optical-panel-rpo4zh_zenod-standalone-data` | no | Test slug by name. |
| `zenod-jordizenodtest-ccnzay` | compose | `compose-parse-online-array-y5wp4v` | done | main | `z-jordizenodtest-ccnzay.zenod.dev` | test | `zenod-jordizenodtest-ccnzay:running` | `compose-parse-online-array-y5wp4v_zenod-standalone-data` | no | Test slug by name. |
| `zenod-jordizenodtest33-gmcxem` | compose | `compose-program-cross-platform-monitor-g4f7e8` | done | main | `z-jordizenodtest33-gmcxem.zenod.dev` | test | `zenod-jordizenodtest33-gmcxem:running` | `compose-program-cross-platform-monitor-g4f7e8_zenod-standalone-data` | no | Active materialized row for duplicate test slug. |
| `zenod-jordizenodtest33-gmcxem` | compose | `compose-program-primary-hard-drive-p3psql` | error | main | `z-jordizenodtest33-gmcxem.zenod.dev` | duplicate | none joined | orphan candidate `compose-program-primary-hard-drive-p3psql_zenod-standalone-data` | no | Failed duplicate record for same hostname; no container joined. |
| `zenod-jordizenodtest33-gmcxem` | compose | `compose-parse-neural-panel-zdjqpz` | error | main | `z-jordizenodtest33-gmcxem.zenod.dev` | duplicate | none joined | orphan candidate `compose-parse-neural-panel-zdjqpz_zenod-standalone-data` | no | Failed duplicate record for same hostname; no container joined. |
| `callisthenes-callisthenestest-vn6wnb` | compose | `compose-synthesize-1080p-system-v1v7gx` | done | main | `c-callisthenestest-vn6wnb.zenod.dev` | test | `callisthenes-callisthenestest-vn6wnb:running` | `compose-synthesize-1080p-system-v1v7gx_callisthenes-data` | yes | Test slug by name; `/connect` probe returned 200. |
| `callisthenes-jorditest2-qmapvn` | compose | `compose-bypass-back-end-protocol-9guvht` | done | main | `c-jorditest2-qmapvn.zenod.dev` | test | `callisthenes-jorditest2-qmapvn:running` | `compose-bypass-back-end-protocol-9guvht_callisthenes-data` | no | Test slug by name. |
| `callisthenes-jordikalitest-godu15` | compose | `compose-synthesize-primary-panel-9xgjg8` | done | main | `c-jordikalitest-godu15.zenod.dev` | test | `callisthenes-jordikalitest-godu15:running` | `compose-synthesize-primary-panel-9xgjg8_callisthenes-data` | no | Test slug by name. |
| `callisthenes-jordicallifresh33087-muhmxp` | compose | `compose-reboot-neural-hard-drive-z8o9gy` | done | `codex/epic2.4-c7-guided-x` | `c-jordicallifresh33087-muhmxp.zenod.dev` | unknown | `callisthenes-jordicallifresh33087-muhmxp:running` | `compose-reboot-neural-hard-drive-z8o9gy_callisthenes-data` | no | Looks like a fresh test row, but name/branch do not prove disposable ownership. Confirm before retirement. |
| `ring-jordiring-fkegkz` | compose | `compose-quantify-open-source-pixel-siik6w` | done | main | `r-jordiring-fkegkz.zenod.dev` | unknown | 6 running suite containers | 6 suite `/data` volumes | no | Active materialized row; owner/live-vs-test not proven by name. |
| `ring-jordiring-fkegkz` | compose | `compose-index-primary-alarm-k4vw2k` | error | main | `r-jordiring-fkegkz.zenod.dev` | duplicate | none joined | - | no | Failed duplicate record for same hostname; no container joined. |
| `ring-jorditestring-0ce4bp` | compose | `compose-navigate-multi-byte-panel-t2b3ik` | done | `codex/epic25-ring-hosted` | `r-jorditestring-0ce4bp.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | no | Test slug by name; active materialized row. |
| `ring-jorditestring-0ce4bp` | compose | `compose-reboot-cross-platform-application-yqru5e` | error | main | `r-jorditestring-0ce4bp.zenod.dev` | duplicate | none joined | - | no | Failed duplicate record for same hostname; no container joined. |
| `ring-ringcloudtest2026070-yfnwxy` | compose | `compose-back-up-bluetooth-bandwidth-xht4be` | done | `codex/epic25-ring-hosted` | `r-ringcloudtest2026070-yfnwxy.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | no | Cloud-test slug by name. |
| `ring-ringe2emain202607092-lw5wat` | compose | `compose-compress-cross-platform-circuit-ewdmj5` | done | main | `r-ringe2emain202607092-lw5wat.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | no | E2E slug by name. |
| `ring-ringnotouch20260709-wl3hhm` | compose | `compose-quantify-redundant-protocol-15cwae` | done | `codex/epic25-ring-hosted` | `r-ringnotouch20260709-wl3hhm.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | no | No-touch test slug by name. |
| `ring-ringtest20260709-8uiw3s` | compose | `compose-parse-mobile-port-nz5tru` | done | main | `r-ringtest20260709-8uiw3s.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | yes | Test slug by name; public health 200. |
| `tenant-testco` | compose | `compose-override-auxiliary-hard-drive-bavq21` | done | main | `z-testco.zenod.dev` | test | 6 running suite containers | 6 suite `/data` volumes | no | Test tenant by name/domain. |

## Ring Suite Container Expansion

Each active Ring suite row materializes six containers with service names:

`zenod-console`, `zenod-zenod`, `zenod-outbound`, `zenod-phylax`, `zenod-archus`, `zenod-epaminon`.

Each active Ring suite row has six mounted volumes:

`console-data`, `zenod-data`, `outbound-data`, `phylax-data`, `archus-data`, `epaminon-data`, prefixed by the compose project name.

Rows with this six-container shape:

| Row | Compose project | Class |
|---|---|---|
| `ring-jordiring-fkegkz` | `compose-quantify-open-source-pixel-siik6w` | unknown |
| `ring-jorditestring-0ce4bp` | `compose-navigate-multi-byte-panel-t2b3ik` | test |
| `ring-ringcloudtest2026070-yfnwxy` | `compose-back-up-bluetooth-bandwidth-xht4be` | test |
| `ring-ringe2emain202607092-lw5wat` | `compose-compress-cross-platform-circuit-ewdmj5` | test |
| `ring-ringnotouch20260709-wl3hhm` | `compose-quantify-redundant-protocol-15cwae` | test |
| `ring-ringtest20260709-8uiw3s` | `compose-parse-mobile-port-nz5tru` | test |
| `tenant-testco` | `compose-override-auxiliary-hard-drive-bavq21` | test |

## Watchdog Map

Read-only command:

```sh
ssh hetzner_vps_1 'systemctl is-enabled zenod-watchdog.timer; systemctl is-active zenod-watchdog.timer; sudo awk -F= ... /etc/zenod-watchdog.env'
```

Result: `zenod-watchdog.timer` is `enabled` and `active`.

| Watchdog entry | Joined row | Class | Notes |
|---|---|---|---|
| `zenod-console` | `c1` | canonical | Core current console. |
| `zenod-z2` | `z2-zenod` | canonical | Core current Zenod. |
| `zenod-phylax` | `phylax` | canonical | Current gateway. |
| `zenod-epaminon` | `epaminon` | canonical | Current Epaminon. |
| `zenod-archus2` | `archus2` | canonical | Current Archus row. |
| `zenod-outbound` | `outbound` | canonical | Current outbound. |
| `zenod-agent-runner` | `zenod-runner` | unknown | Dokploy status says error while Docker is running. |
| `zenod-jordi-f2c7a6` | `zenod-jordi-f2c7a6` | live-paying | Must remain until Zenod migration and human approval. |
| `callisthenes-callisthenestest-vn6wnb` | `callisthenes-callisthenestest-vn6wnb` | test | DX-2 candidate after snapshot policy. |
| `ring-ringtest20260709-8uiw3s` | `ring-ringtest20260709-8uiw3s` | test | DX-2 candidate after snapshot policy. |

Watched health URLs:

- `https://c1.zenod.dev/api/health`
- `https://z2.zenod.dev/api/health`
- `https://z-jordi-f2c7a6.zenod.dev/api/health`
- `https://c-callisthenestest-vn6wnb.zenod.dev/connect`
- `https://r-ringtest20260709-8uiw3s.zenod.dev/api/health`

## Volume Ownership And Orphans

All mounted relevant volumes are tied to the inventory rows in the main table. Unmounted/orphan candidates from the volume snapshot:

| Volume | Classification | Evidence / Next Action |
|---|---|---|
| `callisthenes_callisthenes-data` | unknown orphan candidate | Compose labels point to project `callisthenes`, but no joined container in the Docker snapshot. Verify before cleanup. |
| `code_console-data` | unknown orphan candidate | Compose labels point to project `code`, outside current Dokploy `zenod` rows. Verify owner. |
| `compose-parse-neural-panel-zdjqpz_zenod-standalone-data` | duplicate orphan candidate | Matches failed duplicate `zenod-jordizenodtest33-gmcxem` record. Snapshot before removal. |
| `compose-program-primary-hard-drive-p3psql_zenod-standalone-data` | duplicate orphan candidate | Matches failed duplicate `zenod-jordizenodtest33-gmcxem` record. Snapshot before removal. |
| `zenod-cloud-test-9370a9a_cloud-data` | test orphan candidate | Old cloud-test compose volume; no joined running container. Verify against cloud-test owner before cleanup. |

## DX-2 Candidate List

Candidate rows for early snapshot-plus-retire planning, subject to the spine's snapshot and human gates:

| Priority | Rows | Why |
|---|---|---|
| 1 | `duplicate` rows for `zenod-jordizenodtest33-gmcxem`, `ring-jordiring-fkegkz`, `ring-jorditestring-0ce4bp` | Failed Dokploy duplicates with no active containers. Snapshot any orphan volumes first. |
| 2 | Test Zenod standalone rows except `zenod-jordi-f2c7a6` | Explicit test slugs; running one-container shape. |
| 3 | Test Callisthenes rows | Explicit test slugs; one-container shape. |
| 4 | Test Ring suite rows | Explicit test/e2e/no-touch/cloud-test slugs; each row carries 6 containers and 6 volumes, so snapshot scope is larger. |

Do not include these rows in DX-2 without owner confirmation:

- `zenod-jordi-f2c7a6` (`live-paying`)
- `callisthenes-jordicallifresh33087-muhmxp` (`unknown`)
- `ring-jordiring-fkegkz` active materialized row (`unknown`)
- `x-mcp` (`unknown`)
- `zenod-runner` (`unknown`)
- `callisthenes` canonical domain row and `zenod-cloud-test` domain overlap until steward resolves the `callisthenes.zenod.dev` ownership conflict.

## Acceptance Coverage

- Every Dokploy `zenod` project application/compose row is listed above with status, branch, domains, and classification.
- Matching Docker containers are joined by app/compose project, state, image family, service shape, domain evidence, and mounted volumes.
- Matching Docker volumes are tied to owners in the main table; five unmounted/orphan candidates are listed separately.
- 2.x candidates are classified as `live-paying`, `test`, `duplicate`, or `unknown`; no row is currently `dead`.
- Record-only and failed duplicate rows are distinguished from running containers.
- Watchdog entries are mapped to fleet rows.

## Handoff

Terminal state: ready for testing / DX-2 planning.

Next action:

1. Spine steward reviews the `unknown` rows with Jordi.
2. DX-2 worker defines snapshot destination and retention evidence.
3. DX-2 starts with duplicate/test rows only, not live-paying or unknown rows.
4. Resolve the `callisthenes.zenod.dev` domain overlap before any DNS or Dokploy cleanup touching Callisthenes/control-plane rows.
