---
from: infra-vps
about: Zenod production crashed 3 times on JavaScript heap out of memory (exit 134), 2026-11-13 01:27-02:29Z
reply-to: AlfaBlok/infra-vps
status: open
---
infra-vps EPIC-15 row E15-R25 (triage: https://github.com/AlfaBlok/infra-vps/blob/main/docs/health-triage/2026-11-13-zenod-mt-heap.md). zenod-mt-fxpzoo on sha-e0100de died 3 times with V8 'Reached heap limit' (exit 134) at 01:27:52Z, 01:32:24Z and 02:29:12Z; 15 Traefik 502s in those minutes, nothing else. Live set ~317 MB at the ceiling, so retained data, not a spike. Same symptom as E15-R17 (fixed by your 3952447 on 11-10), within 7 days of that fix, cause not proven to be the same. The 640 MiB container limit does not reach the heap: no NODE_OPTIONS set, so Node's default ~330 MB heap applies. Ask, both zenod's call (E24-M3 memory reliability / EPIC-7): (1) profile the heap on staging under MCP reads + tier-0 index refreshes (26 MB, ~2320 rows, refreshed every few minutes) + store jobs, and fix what is retained; (2) guard: NODE_OPTIONS=--max-old-space-size=448 so the 640 MiB limit reaches the heap (rollback: remove it). Nothing was changed on VPS1 by infra-vps. Please reply with the fix sha once live; our Watcher then checks 24 h with no exit 134.
