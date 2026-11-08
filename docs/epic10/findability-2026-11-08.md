# EPIC-10 findability baseline, 2026-11-08 (E10-R10)

Zenod's position when you search each MCP directory, signed out, on 2026-11-08 between 01:10 and 02:00 UTC.
Taken before all listings are live, so this is the **baseline**, not the E10-4 verdict. Evidence and screenshots: [epic10-r10-2026-11-08](../evidence/epic10-r10-2026-11-08.md).

Zenod listing: `dev.zenod/memory`, "Memory you own: capture on WhatsApp, filed into your Markdown vault, recalled with citations."

| Directory | Listing state | memory | whatsapp | whatsapp memory | notes | second brain | How search works |
|---|---|---|---|---|---|---|---|
| Official MCP Registry ([search](https://registry.modelcontextprotocol.io/?q=memory)) | live (`dev.zenod/memory` 0.1.0) | 62 of 323 (A–Z, first page of 96) | not matched (0 of 43) | 0 results | not matched (0 of 77) | 0 results | substring on the server name only, sorted A–Z, no ranking |
| Glama servers ([search](https://glama.ai/mcp/servers?query=memory)) | not a server listing (a connector, below) | not listed | not listed | not listed | not listed | not listed | full text, relevance |
| Glama connectors ([search](https://glama.ai/mcp/connectors?query=memory)) | live but **Unhealthy** ([listing](https://glama.ai/mcp/connectors/dev.zenod/memory)) | not on page 1 (30 shown) | not on page 1 | not on page 1 | not on page 1 | not on page 1 | full text, "Recommended" order; Zenod is missing even for "zenod" |
| Anthropic directory ([page](https://claude.ai/directory)) | not submitted (R5 waits on E10-A2) | not listed | not listed | not listed | not listed | not listed | no search box signed out |
| Smithery ([search](https://smithery.ai/servers?q=memory)) | closed to self-listing | search returns 0 servers | 0 servers | 0 servers | 4 unrelated | 0 servers | search broken since the Arcade move (31 Oct) |
| mcp.so ([search](https://mcp.so/search?q=memory)) | queued ([issue 6906](https://github.com/chatmcp/mcpso/issues/6906), open) | not listed (1485 results) | not listed (78) | 0 results | not listed (1005) | not listed | full text |
| MCP Market ([search](https://mcpmarket.com/search?q=memory)) | not submitted (form blocks scripted browsers) | not listed | not listed | not listed | not listed | not listed | full text |
| Gemini CLI gallery ([gallery](https://geminicli.com/extensions/)) | repo ready, not yet crawled (0 of 2198 in `extensions.json`) | not indexed (71 results) | not indexed (3) | 0 results | not indexed (22) | not indexed (1) | full text over name and description |
| awesome-mcp-servers | [PR 18864](https://github.com/punkpeye/awesome-mcp-servers/pull/18864) open | n/a | n/a | n/a | n/a | n/a | no search (one README) |

## What ranks above Zenod (top 5)

| Directory | memory | whatsapp memory |
|---|---|---|
| Official MCP Registry | ai.brainmemory/brain, ai.chipp/chipp-memory, ai.counterparts/memory, ai.justonce/memory, ai.konshus/memory (A–Z) | no results (name search) |
| Glama servers | memory by indamices, memory by harsh-gulhane, memory by AlexB00M, Memory by li-shangru, memory (Mnemo) | markdown-to-whatsapp, frugal-memory, personal-memory-mcp, @agentage/mcp-memory, whatsapp-business-mcp |
| Glama connectors | Stele (dev.stele-ai), Mnemoverse Memory, Engram Obsidian Memory Sync, ai.memscope, ai.brainmemory | dev.stele-ai, io.github.mnemoverse, io.github.engram-app, ai.memscope, ai.brainmemory (same as "memory": the WhatsApp half is ignored) |
| mcp.so | AOCI-CODE, PLUR, OpenLore, M1K3, Groundwork | no results |
| MCP Market | Memory (memory-1), Memory (memory-17), Memory (memory-36), Memory (memory-25), Memory (memory-51) | WhatsRust, Narad, GoWA, DMAF, WhatsApp (whatsapp-12) |
| Gemini CLI gallery | deja-vu, Compartment, ownmem, agentic-security, basemind | no results |

## Against E10-4

- "memory" on the first results page of the Anthropic directory and Smithery: **not yet**. Anthropic is not submitted (R5). Smithery is closed to self-listing and its search returns nothing.
- "whatsapp memory" top 3 in every directory with full-text search: **not yet**. The term returns nothing on mcp.so and Gemini (good: once listed, Zenod has no competition there). Glama and MCP Market return results, but Zenod is filtered out on Glama (Unhealthy) and absent on MCP Market.
- Re-run when the R4 listings and R5 are live, or monthly (next 2026-12-08).
