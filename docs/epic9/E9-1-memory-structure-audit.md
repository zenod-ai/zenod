# E9-1: How Zenod structures memory today, and what a tree would change

Parent spine: [EPIC-9 Memory as a tree](../EPIC-9-MEMORY-AS-A-TREE.md) · Ledger row M1 (Done-means E9-1)
Source: Jordi's voice note of 2026-11-01, [obsidian-brain `Log/2026-11-01.md#L131`](https://github.com/AlfaBlok/obsidian-brain/blob/5c9ad9fdbd26dae080dd50a1fa8a8689b76e3a36/Log/2026-11-01.md#L131)
Evidence base: zenod `main` @ `390aaa9` (code) · vault `AlfaBlok/obsidian-brain` @ `5c9ad9f` (2026-11-01 14:49Z) · read-only, nothing changed.
Tree picture (levels 0 and 1): [E9-1-memory-tree.html](E9-1-memory-tree.html)

## Summary

**Short answer to "are we doing the same in Zenod?": no.**

- **What works.** Zenod reliably keeps the raw evidence: every capture lands, dated and anchored, in the daily Log. Pages it writes cite the capture they came from.
- **What is missing.** There is no structure above the pages. There is no tree, no parent field, and no difference between "ongoing now" and "long term". No index is maintained, and no process tidies the vault afterwards.
- **What that does to Jordi's vault.** It has 413 notes. 79% of the notes outside the Log have nothing linking to them. 146 machine-made filing stubs and receipts pile up in `Inbox/`. His four live topics are hard to find:
  - **Hair transplant:** never got a page.
  - **House decision:** spread over 30+ pages in a folder named after a data supplier.
  - **Launching Epic Social / Zenod:** buried in ops reports, which were 34 of the last 52 captures.

EpicSpine's discipline maps well onto this:

- one root, then children, each node one line linking to a detail page;
- a Current State for what is ongoing;
- an Outcome that moves finished work to long-term memory;
- durable facts kept like Operating Learnings;
- a sweep for stale goals.

Two parts of EpicSpine are about execution and should **not** carry over: status-as-task and asks/gates.

The proposal below gives two level-0 groups:

- **Working memory**, with four roots: Launching Epic Social, Launching Zenod, Hair transplant, House decision.
- **Long-term memory**, with five domains.

The Log stays as evidence underneath both.

## 1. How Zenod structures memory today (code)

### Capture → Log (the evidence layer)
- **One writer for all captures.** Every capture goes through `appendEvidence` (`packages/core/src/engine/evidence.ts:37-81`). It appends to `Log/YYYY-MM-DD.md` (:46) with a random anchor `^e-xxxxxx` (:47).
- **Entry format.** Each entry has:
  - a heading `## HH:MM <first 8 words> ^e-…`;
  - the fields `- source:`, `- verbatim:`, `content-type`, `captured-at` and `source-id`;
  - the content as a block quote (:50-64).
- **MCP paths.** `store_memory` (`packages/server/src/mcp.ts:1015-1061`) captures and files in one job (`engine.ts:2015`, files at :2071). `ingest_memory` (`mcp.ts:1064-1165`) works in three steps:
  1. it archives and transcribes the media (`packages/server/src/taskJobQueue.ts:425-502`);
  2. it captures the result `verbatim: true` (:513);
  3. it queues `enrich_memory`, which files later (`engine.ts:1834`, :1912).
- **Duplicate captures** are blocked by `sourceId` (`engine.ts:1788-1796`).
- **WhatsApp.** Phylax forwards each message to one of the two MCP tools (`packages/server/src/phylaxChannels.ts:970-971`, :1912-1939). Capture itself is mechanical, with no model call ([EPIC-MECHANICAL-CAPTURE](EPIC-MECHANICAL-CAPTURE.md) D1, D4).
- **Raw media** goes to `_attachments/` or Drive and is write-once (`packages/core/src/vault/immutability.ts:10-38`).

### Filing (the librarian)
Filing is one inline LLM pass per capture. **No librarian runs in the background.**

- **Classify** (`packages/core/src/llm/aisdk.ts:998-1084`, prompt at :1018-1039).
  - The model sees a flat page catalogue: `path | title | aliases | fact keys | tags | summary` (:999-1001).
  - It splits the capture into "ONE independently maintainable proposition" per topic (:1022).
  - It picks one of four dispositions: `evidence_only`, `append_compact_note`, `integrate_page` or `needs_clarification` (:1029-1032).
- **Folder rule.** The rule is a single sentence: "Areas/ (ongoing life domains), Projects/ (finite work), Notes/ (reusable knowledge)" (:1035).
  - The model writes the full path itself, for example `Areas/Insurance.md` (:670).
  - Code checks only that the top folder is one of the three (`packages/core/src/vault/files.ts:9-13`, enforced at `engine.ts:1625-1637`).
  - Subfolders such as `Projects/Zenod/` are therefore free-form.
- **Choosing a page.** Candidate pages are found lexically, using IDF-weighted terms (`packages/core/src/engine/meaningNotes.ts:24-30`). The rule is "prefer updating an existing page over creating a near-duplicate; confidence below 0.7 means ask" (`aisdk.ts:1039`).
- **Writing a page.** There are three paths in `engine.ts:1543-1772`:
  - **Reconcile** (:1644-1712): ADD, LINK_SOURCE, SUPERSEDE, CONFLICT or CLARIFY. Each becomes a quoted bullet with a citation (`reconciliation.ts:347-348`).
  - **Compact:** `## Captured update — date` (`engine.ts:1719-1720`).
  - **Compose:** "integrate, don't append a changelog", and the page must wikilink at least one existing page (`aisdk.ts:1151-1154`).
- **Links.** `relevantLinks` adds up to three lexically similar pages, plus a link to the folder's index (`meaningNotes.ts:243-252`). This is the only link-building in the system.
- **Frontmatter.**
  - Lint requires `title, type, tags, created, updated, summary` (`packages/core/src/vault/lint.ts:11`).
  - The page template adds `description, timestamp` (`engine.ts:417-429`).
  - Host-written `memoryFacts[]` carry an `evidenceRef` (`temporalFacts.ts:179-181`).
  - **There is no `parent`, `status`, `source` or `ongoing` field.**
- **Lineage.** Lineage runs one way only: page → `[[YYYY-MM-DD#^e-…]]` (`engine.ts:1622`), and lint checks that it resolves (`lint.ts:146-155`). Nothing records which pages a Log entry became, apart from the Inbox receipts below.
- **Uncertain filing.** The librarian writes:
  - `Inbox/needs-filing-<stamp>.md` stubs (`engine.ts:1350-1366`);
  - `Inbox/filing-<date>-e-….md` receipts (:1751-1757, `packages/core/src/engine/filingReceipt.ts`).

  Nothing ever comes back to resolve them.
- **Indexes and maintenance.**
  - Only `Areas/Areas Index.md` and root `index.md` are seeded (`packages/core/src/vault/migrate.ts:37-76`), and no code maintains them.
  - [LIBRARIAN-DOCTRINE](LIBRARIAN-DOCTRINE.md) describes a nightly **compactor** (merge duplicates, connect pages) at :72. **It was never built.**
  - Tidying exists only as a user-started `run_task` (`mcp.ts:1262-1267`, prompt `aisdk.ts:2165-2187`).

### Retrieval
- **All lexical.** No embeddings exist.
- **`search_memory`** (`mcp.ts:933-980` → `packages/core/src/ops/search.ts:39-133`) works in three passes:
  1. it scores frontmatter (title 10, tag 4, filename 3, summary 2);
  2. it matches Log filenames;
  3. it runs ripgrep over page bodies.
- **`get_memory`** (`mcp.ts:982-1013`, `ops/get.ts:17-51`) returns a single page or Log entry. It returns **no parent, backlinks or lineage**.
- **`ask_brain`** (`mcp.ts:1194-1235` → `engine.ts:2241`) is an LLM tool loop. Its tools are `searchVault`, `searchEntries`, `readNote`, `listPages`, `readFacts` and `searchChats` (`engine.ts:666-740`). Its briefing is the vault `AGENTS.md` plus a flat page map (:596-663).

### Recorded decisions on memory
- **Root spine.** [EPIC-0](EPIC-0-FOUNDATION-SPINE.md) D25–D34 contain nothing on memory structure. Archived history covers three points:
  - D14: the alpha milestone is the core memory product.
  - D15: memory plus execution, with store-only vs store-and-execute.
  - D20: the backend owns memory; Phylax owns transport and speech-to-text.

  Source: `docs/archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md:237-243`.
- **ZMR** ([EPIC-ZENOD-MEMORY-RELIABILITY](EPIC-ZENOD-MEMORY-RELIABILITY.md), superseded):
  - D1: retrieval completeness and categorisation accuracy first; cleanup later.
  - D2: never rewrite evidence; meaning and indexes are derived from it.
  - D10: one voice note may update several branches with the smallest cited change.
  - D11: bounded branch discovery and explicit pending.

  "Cleanup later" and "indexes derived" were never built. **This epic is where they land.**

## 2. Jordi's vault as Zenod has filed it

**Which vault.** Jordi's production tenant is `github-63050995` on VPS1 `zenod-mt-fxpzoo`; this was checked read-only on 2026-11-01. Its `/data/github-63050995/vault` clone pushes to `AlfaBlok/obsidian-brain`, and its HEAD `5c9ad9f` equals GitHub `main`. `zenod-bot` wrote 93 of the last 100 commits.

**Layout and counts.** The vault holds 510 files, of which 413 are markdown.

| Top level | .md notes | Notes with no inbound link | What it holds |
|---|---:|---:|---|
| `Inbox/` | 172 | 157 | 77 `needs-filing-*` stubs (2026-06-11 to 09-13, none resolved), 69 `filing-*` receipts (09-07 to 11-01), 2 Notion imports, about 12 `Untitled`/`new note`/`Test 21` files |
| `Log/` | 93 | n/a | 498 captures. By source: mcp 390, whatsapp 94, drive 10, web 4. By month: Jun 156, Jul 149, Aug 98, Sep 43, Oct 30, Nov 1st day 22 |
| `Projects/` | 83 | 51 | flat files, plus `Projects/Zenod/` (32) and `Projects/Idealista Data Relationship/` (30+) |
| `_attachments/` | 22 | 22 | a vendored skill repo (13 `SKILL.md`), media |
| `Notes/` | 19 | 10 | runbooks and research |
| `Areas/` | 7 | 0 | Housing, Insurance, Tax/AEAT, Hardware, Family, Positioning |
| root, `_templates/`, `Council/`, `docs/`, `Archive/` | 17 | all | `index.md` and `Index.md` side by side, `index_old_archive.md`, old launch docs, the vault's own EpicSpine root |

- **Links.** Outside the Log there are 320 notes. **254 (79%) have no inbound wikilink, and 183 (57%) have no links in or out.**
- **Index pages.** `Projects Index` links 4 of 83 projects, `Areas Index` links 0, and `Notes Index` links 1.
- **Back-lineage exists where filing worked.** 224 notes cite a Log entry, but only 7 have anything like a parent field.

**How a typical capture lands.** Take Jordi's 2026-10-31 hair-transplant captures, three of them via MCP:
- each was appended to `Log/2026-10-31.md` (`^e-8b5114`, `^e-70a449`, `^e-c64e3b`);
- the classifier labelled the topic `"confidence"` and targeted a non-existent `Projects/hair_flow.md`;
- it then failed with `reason: page_filing_failed`.

Result: three receipts in `Inbox/` (`filing-2026-10-31-e-8b5114.md` …) and **no page about the hair transplant anywhere.**

Of the 15 voice notes and images captured in October and November:
- 5 reached a topic page;
- 9 reached only a receipt;
- 1 had not been filed yet: today's 30-minute note, `^e-876431`, which is the source of this epic.

**The filing backlog in numbers.** Across the 69 receipts:

| Count | Status or reason |
|---:|---|
| 133 | filed |
| 118 | uncertain |
| 107 | pending |
| 56 | unresolved |
| 38 | `source_not_assigned` |
| 27 | `reconciliation_validation_failed` |
| 22 | `page_filing_failed` |

**36 of the 69 receipts filed nothing at all.**

## 3. Where it gets untidy (ranked)

1. **Nothing above page level.** You cannot see "what am I working on" or "what is this part of":
   - no tree, no parent, no ongoing-vs-long-term field;
   - indexes are unmaintained (4 of 83, 0 of 7, 1 of 19 linked);
   - `Projects/` is described as "active or historical", so it mixes both.
2. **Failed filings pile up and are never closed.** There are 146 machine stubs and receipts in `Inbox/` (85% of Inbox). The first stub dates from 2026-06-11 and none has been resolved.
   - Each one is a capture that Zenod understood only as evidence.
   - Live topics are among them. Hair transplant has three receipts and no page.
3. **Ops telemetry swamps Jordi's thoughts.** 34 of the last 52 captures (2026-10-28 to 11-01) are agent reports, for example:
   - `infra-vps EPIC-15 Watcher read…`;
   - `agent_team console E6-S36…`.

   They land on product pages such as `Projects/Zenod.md` and `Notes/Alpha9 Dokploy VPS.md`, which grow without bound (22.6 KB and 21.2 KB).
4. **Pages become append-only changelogs, with test data and real data mixed.** `Projects/Zenod.md`:
   - repeats the heading `## Evidence-qualified updates` twice and has `## Captured update` blocks;
   - mixes canary codewords from test runs ("ZENITH-4471", "blueberry", "Silver Orchard 4") with real strategy;
   - holds an off-topic real-estate paragraph (Maresma/Cerdanya debt targets);
   - still shows `updated: 2026-09-06` although it was written to on 2026-11-01. Only 3 of 107 meaning pages show an Oct/Nov `updated:`.
5. **Duplicates and scattered pages.** 8 pages exist twice by title across folders:
   - `Positioning & Story` (Projects + Areas);
   - `Hardware & Devices` (Notes + Areas);
   - `Poly-Maker Runbook (extension)` (Projects + Notes);
   - `Zenod Workflow Learnings`, `Story & Slides` and `Phylax … Gateway` (Projects + Projects/Zenod);
   - `IdeaScraper …` (Projects + Projects/Idealista Data Relationship);
   - `Index.md`/`index.md`, which collide on a case-insensitive Mac checkout.

   There are also near-duplicates. `Hosted Zenod (M3 Multi-Tenant) Plan` sits beside `Hosted Zenod (M3) Multi-Tenant Plan`, and one email has 12 versions (`email_comercial` v1–v8 + v2_1–v2_3).
6. **Wrong home and wrong name.** The house decision lives under `Projects/Idealista Data Relationship/`, a folder named after a data supplier. The topic labels the classifier makes up are noisy: `"confidence"` was used for the hair-transplant notes, and some topic labels are whole sentences.
7. **Leftovers from outside the schema.** These folders sit outside the three meaning folders, so lint and the page catalogue never see them:
   - `Council/` (3 July launch docs);
   - `docs/` (the vault's own EpicSpine root, which is about vault upkeep, not Jordi's thoughts);
   - `index_old_archive.md`;
   - a vendored skill repo in `_attachments/`.

## 4. What EpicSpine's discipline would change

| EpicSpine practice | Memory equivalent | Carries over? |
|---|---|---|
| Root → children with `Parent spine:` lineage | Each memory node has one parent. The path from the root *is* the context, so nothing needs repeating | **Yes, the core of it** |
| `## Current State` of an active epic | **Working memory**: a root is "ongoing" while it has a one-line Current State (what is live now, last touched, open questions) | **Yes** |
| `## Outcome` + `Status: done` closes a goal | **Closure**: when a working-memory root ends, write one Outcome line and move it under a long-term domain, keeping its children | **Yes** |
| One line per node, detail in linked pages | A node is one line (title + one sentence + link). Pages hold the detail; the tree file stays readable at levels 0 and 1 | **Yes** |
| Operating Learnings (durable rules) | Durable facts and preferences (`memoryFacts`) live on the long-term node they belong to, each with its evidence link | **Yes** |
| SessionStart stale-goal flags | Weekly **sweep**: a working-memory root untouched for 30 days is offered as "keep, close, or fold into another root". Failed filings are re-run or attached to a node | **Yes, as a sweep** |
| Issue Ledger, statuses, asks, human gates | Memory is not execution. No done/blocked/waiting fields, and nothing that tracks progress | **No** (that is Agent Team's job) |
| Dispatching workers | No. Filing places memories; it doesn't act on them | **No** |
| Decisions table | Partly. The LINK_SOURCE/SUPERSEDE history already records changes of mind on a page | Already there |

## 5. Proposal: Jordi's tree at levels 0 and 1 (what E9-2/E9-3 would build)

Picture: [E9-1-memory-tree.html](E9-1-memory-tree.html). The Log is not a branch of the tree; it is the evidence underneath it.

```
WORKING MEMORY (ongoing now)
├─ Launching Epic Social — pipeline idea→draft→approved→posted · post topic list · Agent Team (console, Team desk,
│                           milestones, multi-tenant, email) · brand EpicSpine/Epic Team/Epic Social · Reddit+X launch, testers
├─ Launching Zenod         — alpha launch (ZAL) · memory as a tree (EPIC-9) · production health · positioning
├─ Hair transplant         — options dossier (hair_flow) · 2023 Barcelona quotes · open: budget, destinations, timing
└─ House decision          — location shortlist (Maresme vs Cerdanya, altitude, Sardinia) · legal exposure · yield &
                             financing · data sources (Idealista, IdeaScraper)
LONG-TERM MEMORY (what lasts)
├─ Ventures and work       — Alpha9 company (tax/AEAT, gestorías) · trading (Poly-Maker, Polymarket) · Altamira2050/PatronBTC ·
│                            RepoMiningFunding · OpenProp legal · Zenod history
├─ Ideas and knowledge     — markets & finance research · AI & agents (EpicSpine doctrine) · story & positioning
├─ Infrastructure & runbooks — VPS fleet + incident lessons · accounts & access (GitHub, Gmail, browser)
├─ Life admin              — housing (general), insurance, hardware, health, travel
└─ People and family       — private; detail stays in the notes
```

**How a new memory gets placed.** These are the rules the librarian would follow:

1. **Capture as today.** Append it to the Log verbatim; that is the evidence and it is never rewritten (ZMR D2).
2. **Place it as a leaf with a parent.** Walk down from the roots, using the one-line summaries at levels 0 and 1. Pick the deepest node it belongs to and write the memory onto that node's page, citing `^e-…`.
3. **Ongoing goes to working memory.** If it is about something ongoing (a plan, a decision in progress), place it under a working-memory root. Durable facts, preferences, runbooks and finished things go under a long-term domain.
4. **New subjects get a provisional node.** If nothing fits, create the node under the closest parent and mark it `provisional`. Never leave an orphan or a receipt-only capture; a capture always lands *somewhere* in the tree.
5. **Agent ops reports file differently.** They go to one dated rollup line under their project node, not into the body of the product page.
6. **Record both directions of lineage.** The page cites the Log entry (as today). The Log entry gets a `- filed: <node path>` line, so every capture can say where it went.
7. **A weekly sweep keeps the tree tidy:**
   - re-file pending receipts;
   - merge duplicates by title;
   - offer stale working roots for closure (Outcome line → long-term);
   - rebuild the level-0/1 file.

**How retrieval returns lineage.** `search_memory`, `get_memory` and `ask_brain` would return each hit with its **path**, for example `Working › Hair transplant › 2023 Barcelona quotes ← Log 2026-10-31 ^e-c64e3b`. `get_memory` on a node would also return its parent line and children's one-liners. `ask_brain`'s briefing would start from the level-0/1 tree, not a flat page map. The answer then carries the context, so Jordi never has to restate it.

**Candidate ledger rows for E9-2 (build the tree) and E9-3 (retrieval with lineage):**

| Row | Title | Depends on | Done check |
|---|---|---|---|
| E9-2a | Tree file and node schema: `Tree.md` (levels 0/1, one line per node) + page frontmatter `parent:`, `memory: working\|long-term` | M1 accepted | Lint passes on a fixture vault; every meaning page has a resolvable `parent` |
| E9-2b | Librarian places every capture as a leaf with a parent (rules 2–6), with `- filed:` written back on the Log entry | E9-2a | On a synthetic replay of 20 real-shaped captures, 0 receipt-only results and 100% have `filed:` + `parent` |
| E9-2c | One-time migration of Jordi's vault into the tree, run as a reviewed proposal (moves, merges, 146 Inbox items re-filed or archived), with no Log rewrite | E9-2a, Jordi OK on the tree | Jordi sees the level-0/1 page and recognises his world; Inbox machine files = 0; nodes with no inbound link < 10% |
| E9-2d | Weekly sweep job: stale working roots → offer closure, pending receipts → re-file, duplicate titles → merge proposal | E9-2b | One sweep run on prod produces a report and leaves the tree lint-clean |
| E9-3a | Retrieval returns lineage: `search_memory`/`get_memory` hits carry the node path + evidence anchor; `get_memory` on a node returns parent + children | E9-2a | MCP tool-output schema updated; a test asserts the path on 5 hits |
| E9-3b | `ask_brain` briefs from the tree and cites the path in answers | E9-3a | 5 lineage questions ("where did X come from?") answered with the right path |

## 6. Open questions for Jordi (we proceed on the default unless he objects)

1. **Do the working-memory roots match the Agent Team milestones, or are they set separately?** *Default:* Zenod proposes them from what was captured in the last 30 days, and Jordi's word is final. They start as the four he named: Epic Social, Zenod, Hair transplant, House decision. Zenod does not read Agent Team. Memory serves retrieval, and the milestones serve execution.
2. **Where do the agent ops reports go?** These are Watcher reads and console decisions, 65% of recent captures. *Default:* keep capturing them, but as one dated rollup line per project node. They should stop growing the product pages, and should not count as "ongoing" on their own.
3. **How should the one-time migration of the existing vault be done?** *Default:* as one reviewed proposal that Jordi skims. It moves and merges pages and never deletes: anything unsure goes to `Archive/`. The Log stays untouched. Nothing is applied until he says go (E9-2c).
