# E9-4: Digestion design: how the memory tree emerges bottom-up and stays tidy

Parent spine: [EPIC-9 Memory as a tree](../EPIC-9-MEMORY-AS-A-TREE.md) · row E9-4 · run `run_f6565d0c-5586-45c2-88b2-0224a012e1ce` · answers Jordi's E9-A5 (2026-11-02) · follows EPIC-9 L-1 (roots are discovered from content and freshness, never seeded).
Deck: [E9-4-digestion-deck/index.html](E9-4-digestion-deck/index.html), which has 18 slides. It is served on the tailnet at http://100.86.141.63:8854/ and the source is `deck.src.html`, built by `build.py`.
This is research and design only. Nothing in production or in the vault was changed. Vault facts here are names and counts only.

## Summary

- **Two loops.** Ingestion, which is built and works, files each capture in seconds. Digestion is a separate slow loop run by one **memory-keeper** persona:
  - a daily light wake that is deterministic and costs $0;
  - a weekly digestion capped at $0.05.
- **Few changes a week.** The keeper re-derives topics and heat for free, matches them to last week's roots so names stay stable, applies Jordi's steering first, and makes **at most 3 structural changes a week**. Doing nothing is the default. Every change is one revertable vault commit.
- **Steering sticks.** Pins, renames, aliases and "that's wrong" become one-line Keeper notes, the vault's equivalent of Operating Learnings. The keeper never overrides them.
- **Retrieval tier 0** is a per-user SQLite FTS5 index over pages, Log entries and roots, with the lineage in front of each row. It costs $0 and runs in milliseconds, and it becomes ask_brain's first search.
- **Cost.** Refining the tree is cheap. The structure work needs no model. The model names and summarises only what changed, for an estimated $0.04–0.09 per user per month, hard-capped at about $0.22, which is 7% of the $3 allowance.
- **Build plan.** Six rows, E9-5a to E9-5f, starting with the index. Jordi gets one ask with three defaults folded in.

## 1. The problem, in Jordi's words (E9-A5)

> "It must be pretty expensive to refine the structure, or is it? Do we need … a persona that wakes up and works on your memory, and keeps it organized? … a strong story for retrieval … an index, so that we do inexpensive deterministic retrieval of thoughts, just keyword search … Do we do this in two steps … ingestion and then digestion? … maybe the digestion is a slow process … how disciplined are we about keeping things tidy? … the output of which is a tree that is immediately recognizable."

Where we stand:

- E9-2b to E9-2h built filing into the tree, bottom-up roots and a weekly sweep. E9-3a to E9-3c made ask_brain cite the path, scoring 9–10 of 10.
- Jordi: "much better". Agentine (top of his world, separate from EpicSpine and Zenod) and Family are still missing. E9-2i owns that fix.
- A likely cause for Agentine: the word never appears in the vault. "Agentine" looks like how "agent team" comes out of transcription. There are 15 pages and 5 Log days that mention agent team or agent_team.
- That points to the need for **aliases** (§5).

## 2. Ingestion vs digestion

| | Ingestion (fast loop) | Digestion (slow loop) |
|---|---|---|
| When | every capture, seconds | daily light wake about 02:00 UTC; weekly digestion on Sunday; an early wake when ≥ 10 own captures sit on pages with no topic, at most once a day |
| Who | librarian (E9-2b) | memory-keeper persona (new; extends the E9-2d sweep job) |
| Does | Log entry (append-only), page filing with a parent, a `filed:` line, and an index row (new) | replay: re-read recent captures next to older pages, re-derive topics and heat, match to last week's roots, apply steering, choose ≤ 3 changes, refresh the "Now" lines of changed roots, write one commit and a "Recent changes" line |
| Model | one filing call per capture | none for structure; a cheap call only to check a name or rewrite a "Now" line for a root whose pages changed |
| Analogy | hippocampus: fast, specific, episodic | neocortex: slow, structured, learns by interleaved replay (McClelland, McNaughton & O'Reilly 1995) |

What exists today and what is missing:

| Built | Missing |
|---|---|
| Filing into the tree, lineage to the leaf (E9-2b, 2f) | **Stable identity**: roots are re-derived each week with no memory of the last ids |
| Bottom-up roots: TF-IDF + average linkage; heat from own captures with a 14-day half-life; hysteresis 0.9/0.3; agent reports never count (E9-2g, 2h) | **Steering**: no pin, rename, alias or "that's wrong" |
| Weekly sweep: no model, one commit, nothing deleted (E9-2d) | **Root "Now" lines and Outcome on close** |
| ask_brain with lineage, $0.0016 per ask (E9-3c) | **An index**: `search_memory` re-scans the vault with ripgrep on every query (`packages/core/src/ops/search.ts`) |

## 3. Mock-up: the tree emerging bottom-up

These are frames for a user starting fresh, using Jordi's real topic names. Counts are invented for illustration and no note text is used. The deck shows each frame as a tree (slides 5–8).

**Day 1.** Seven captures arrive: a Zenod launch plan, an Agentine persona wake, an EpicSpine skill note, a house visit, the kids' school term, an AEAT letter and a clinic quote.
- Each becomes a page under "Not yet a topic".
- There are no roots, because one day is too little evidence to call something a topic.
- The daily wake updates heat and the index and makes no structural change.

**Week 1.** The first weekly digestion clusters 28 pages.
- Zenod (9), Agentine (7, including 2 EpicSpine pages), House (5) and Family (4) are dense and warm, so they are promoted to working roots.
- Each is named from Jordi's own titles and words. One cheap call per new root checks the name. Each gets a "Now" line.
- Tax (2 pages) and the clinic quote (1) wait.
- Changes: 4, within a first-week allowance of 6.

**Month 1.**
- Jordi steers: "EpicSpine is not Agentine. Agentine is the agent team." That becomes two Keeper notes: keep the two apart, and an alias.
- EpicSpine is **split** out of Agentine, which keeps its id, its name and Jordi's pin.
- "Launching Zenod" is **merged** into Zenod, because the names refine each other (E9-2h rule).
- Hair transplant is **promoted** after a burst of quotes.
- Tax gets no capture for 30 days, **cools** and moves to long-term as "Admin and tax", keeping its children.

**Month 3.**
- House reaches a decision. The keeper proposes **closing** it with one Outcome line citing the capture where Jordi said so. Jordi says yes, and House moves to long-term with its story intact.
- Hair transplant closes and **folds** under a long-term "Health" area.
- Areas like Family never close: they only cool and warm, like a standing spine.
- 9 of 10 roots keep the id and name they had a month earlier.

## 4. Rules that keep it recognisable

1. **Stable identity.** Each root has an id. This week's cluster inherits last week's id and name when the two share at least half their pages (Jaccard ≥ 0.5, one-to-one matching, largest overlap first). A split gives the id to the larger part.
2. **Change budget.** At most 3 structural changes a week: promote, close, merge, split or rename. The first digestion of a new vault gets 6. Doing nothing is the default.
3. **Hysteresis everywhere.** Promotion at heat 0.9 and demotion below 0.3 are already built in E9-2g. A merge or split needs the same signal on two weekly runs in a row.
4. **Jordi's words win.** Names come from his titles and his own captures. A pin, a locked name, an alias or a keep-apart note is never undone by the keeper.
5. **Evidence before structure.** A root needs at least 3 pages, or one week of own captures. Below that, pages wait under "Not yet a topic".

Test: replay Jordi's last 8 weeks of Log onto a clone, one week at a time.
- At least 80% of roots keep their id and name from one week to the next.
- No week has more than 3 changes.
- Jordi recognises the final tree.

## 5. The memory-keeper persona

**Daily light wake (about 02:00 UTC, $0, no model, no structural change):**
- update heat from yesterday's own captures;
- refresh the index rows of changed pages and check the index against the vault's git head;
- queue provisional leaves for the weekly wake.

**Weekly digestion (Sunday, ≤ $0.05):**
1. re-derive topics and heat (E9-2g/2h code);
2. match them to last week's roots;
3. apply Keeper notes;
4. choose at most 3 changes, with doing nothing as the default;
5. make model calls only for roots whose pages changed, to check the name and rewrite the "Now" line (where it stands, the latest own capture, an open question), each line citing Log anchors;
6. write one vault commit, `memory: keeper (…)`, plus one line under `## Recent changes` in Tree.md, which the Memory tab shows.

**In agent_team terms:**
- It follows the Delivery Manager remit, scoped to one vault: reconcile, advance, blockers, report.
- It is the single writer of Tree.md, like a spine steward.
- It asks at most one question a week, and only when two candidate changes are near a tie. The idea is the Unblocker's: never ask what the record already settles.

**Runs where.** On the tenant's durable task lane (the E9-2d `tree_sweep` job grows into it), under the vault write lock, metered against the tenant's $3 allowance. It has a hard cap of $0.05 per week.

**How Jordi steers.** He can do it on WhatsApp or in the Memory tab:

| Jordi says or taps | Written | Effect |
|---|---|---|
| Pin Agentine | `pinned: true` on the root page | never demoted or renamed |
| Rename Housing → House | `name-locked: true` | the keeper keeps his name |
| "Agentine is the agent team" | `aliases: [agent team, agent_team]` | search and clustering treat them as one term |
| "EpicSpine is not Agentine" | Keeper note: keep apart | never merged |
| "That's wrong" on a change | revert of that change, plus a note | not proposed again for 8 weeks |
| "Yes, close House" | an Outcome line citing his capture | moves to long-term |

Keeper notes live in Tree.md under `## Keeper notes`, one line each, in the same shape as EpicSpine Operating Learnings: `K-<n> | applies when | rule | why | confirmed date`.

**Never:**
- delete a page;
- edit or reorder the Log;
- rewrite Jordi's own words on a page;
- override a pin, a locked name or a Keeper note;
- count agent reports as his activity;
- make more than 3 structural changes a week;
- send note text to a provider beyond the metered naming and "Now" calls.

The Librarian Doctrine's line still holds: autopilot only for changes that one revert undoes.

## 6. Retrieval

**Tier 0 is a deterministic index.** It is one SQLite FTS5 file per tenant, derived from the vault and rebuildable. `node:sqlite` is already used in `packages/core/src/state/sqlite.ts`.

- **Rows:**
  - pages: title, aliases, lineage path, summary, "Now" line, body;
  - Log entries: date, source, first line, text, and the page they were `filed:` on;
  - root rows (RAPTOR's "collapsed tree": all levels in one pool).
- **Ranking:**
  - `bm25()` with column weights: title and aliases 10, path 5, summary 3, body 1;
  - tokenizer `unicode61 remove_diacritics 2` for Spanish and English, with no Porter stemmer, which is English-only;
  - each row's text is prefixed with its lineage ("Working › House › Visits"), a deterministic version of Anthropic's contextual BM25.
- **Freshness:**
  - the librarian updates the row of each page it writes;
  - the daily wake checks the index against git HEAD;
  - `zenod index rebuild` rebuilds from scratch.
- **Cost:** $0 and milliseconds per query, with the same answer every time.

| Tier | What | Cost per query | Status |
|---|---|---|---|
| 0 index | FTS5 over pages, Log and roots, with lineage | $0 | proposed E9-5a |
| 1 tree walk | the root's "Now" line plus the leaf tier 0 points to, no model | $0 | proposed E9-5d |
| 2 ask_brain | tree briefing plus tier-0 hits, then the model reads and answers with the path | $0.00133 per answer call; about $0.0016 per ask including retries (E9-3c, measured) | live |
| later semantic | embeddings as a reranker over tier 0 | tbd | not now: under about 1,000 notes, lexical search suffices (Librarian Doctrine) |

## 7. Cost model

| Step | Model? | Per user per month | Basis |
|---|---|---|---|
| Topic discovery, heat, roots, sweep | no | $0 | measured: E9-2d/2g/2h run with no provider call (`treeDiscover.ts` is TF-IDF + clustering) |
| Index upkeep | no | $0 | SQLite, seconds of CPU |
| Keeper names and "Now" lines | only for changed roots | ≈ $0.04–0.09 | estimate: ≤ 10 calls a week at ≤ $0.002 each. The ceiling is set above a full 47k-token ask call on gpt-5.6-luna, measured at $0.00133 |
| Keeper hard cap | | ≤ $0.22 | $0.05 a week, enforced |
| Onboarding backfill (≈ 100 pages, once) | yes | ≈ $0.20 once | estimate: one summary call per page |
| Ask | yes | $0.0016 per ask | measured E9-3c (48 calls, 73% cached input); $3 covers about 1,900 asks |
| Filing a capture | yes | not split out in the ledger yet | E9-5c measures it |

Reference points:
- Jordi's tenant had spent $0.97 of $3 in November as of 2 November, including the E9-3c eval ($0.064).
- His vault holds 623 Log entries from June to November. Most are MCP and agent traffic; 105 came over WhatsApp, 10 from Drive and 4 from the web.

**Answer to "is it expensive?"** No.
- Structure is deterministic and free.
- Only naming and summarising use a model, and only for what changed.
- GraphRAG's cost comes from summarising every community up front. LazyGraphRAG reports indexing at 0.1% of that cost by deferring summaries, and we follow the lazy path.

## 8. What we borrow from EpicSpine and agent_team, and what EpicSpine gains

| EpicSpine / agent_team | Memory tree |
|---|---|
| root → child spines, one line each | Tree.md levels 0–1, root pages |
| Current State | each root's "Now" line |
| `## Outcome` on close | Outcome line, then long-term |
| standing spine (never closes) | areas: Family, Health, Admin |
| Operating Learnings (one line, scoped, confirmed date) | Keeper notes |
| stale sweep (14 days, `tree_audit.py`) | heat with a half-life, hysteresis, weekly digestion |
| steward = single writer | keeper = single writer of Tree.md |
| Delivery Manager wake (reconcile, advance, blockers, report); the Unblocker answers what is settled | keeper wake; asks only near-ties |

**Left behind:** status-as-task, asks and gates, and dispatch (EPIC-9 Non-Goals). The difference that matters (L-1) is that agent_team's roots are picked by hand, while Zenod's are found.

**What EpicSpine should gain (E9-5f):**
- A small shared tree library:
  - heat with a half-life instead of the binary 14-day stale flag, so `spines.py --active` can rank by heat;
  - stable ids across re-derivations;
  - a "Recent changes" rollup.
- A reference page in the skill for the **steward persona pattern**: reconcile → budgeted changes, NOOP by default → report, used by spine stewards and by the keeper.
- Zenod does not import the skill at runtime. The library is a shared design, ported, not a dependency.

## 9. Outside research: what transfers

| Work | Claim (as published) | Transfers |
|---|---|---|
| Complementary learning systems: McClelland, McNaughton & O'Reilly 1995, [doi:10.1037/0033-295X.102.3.419](https://doi.org/10.1037/0033-295X.102.3.419) | fast hippocampal learning, slow cortical learning, interleaved replay | Log = fast store, tree = slow store, keeper = replay |
| MemGPT, [arXiv 2310.08560](https://arxiv.org/abs/2310.08560); [Letta docs](https://docs.letta.com/concepts/memgpt) | memory tiers; the agent edits its own memory | a small always-loaded tier: Tree.md plus "Now" lines |
| Sleep-time compute, [arXiv 2504.13171](https://arxiv.org/abs/2504.13171); [Letta blog](https://www.letta.com/blog/sleep-time-compute) | precompute while idle; about 5× less test-time compute at equal accuracy on its benchmarks (reasoning tasks, not memory curation) | digestion as its own background persona |
| Zettelkasten, [zettelkasten.de](https://zettelkasten.de/introduction/); PARA, [fortelabs.com/blog/para](https://fortelabs.com/blog/para/); [progressive summarization](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/) | hub notes emerge on density; items move by actionability; archive, never delete; summarise only what gets revisited | roots on density; project vs area; Outcome then long-term; lazy "Now" lines |
| GraphRAG, [arXiv 2404.16130](https://arxiv.org/abs/2404.16130); [LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag/) | Leiden communities plus LLM summaries per level; the lazy version indexes at 0.1% of the cost | cluster for free; summarise only changed roots |
| RAPTOR, [arXiv 2401.18059](https://arxiv.org/abs/2401.18059) | recursive cluster-and-summarise tree; collapsed-tree retrieval works best | root rows and page rows in one FTS table |
| mem0, [arXiv 2504.19413](https://arxiv.org/abs/2504.19413) | ADD/UPDATE/DELETE/NOOP; vendor-reported 91% lower p95 latency and >90% token savings vs full context | small op set, NOOP default |
| A-MEM, [arXiv 2502.12110](https://arxiv.org/abs/2502.12110) | Zettelkasten-style notes that link and evolve on insert | link proposals belong in digestion, not in the fast path |
| Generative Agents, [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) | recency + importance + relevance; reflect when summed importance passes a threshold | half-life heat (built); early wake on a backlog |
| SQLite FTS5, [sqlite.org/fts5.html](https://sqlite.org/fts5.html) | `bm25()` column weights, `unicode61 remove_diacritics`, external content, `snippet()` | tier-0 index design |
| Contextual Retrieval, [anthropic.com/news/contextual-retrieval](https://www.anthropic.com/news/contextual-retrieval) | top-20 retrieval failure 5.7% → 3.7% with contextual embeddings → 2.9% adding contextual BM25 → 1.9% with a reranker | prefix each indexed row with its lineage |
| Zep/Graphiti, [arXiv 2501.13956](https://arxiv.org/abs/2501.13956); [LangMem](https://langchain-ai.github.io/langmem/) | bi-temporal facts invalidated, not deleted; background memory manager | Outcome rather than deletion; consolidation off the request path |
| Cluster matching: [Jaccard index](https://en.wikipedia.org/wiki/Jaccard_index), [Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm), BIRCH ([doi:10.1145/233269.233324](https://dl.acm.org/doi/10.1145/233269.233324)) | standard practice: match clusters across runs by member overlap | stable root ids and names |

Verification:
- Checked directly in this research pass: the Contextual Retrieval figures, the mem0 abstract figures, the sleep-time compute abstract and the LazyGraphRAG 0.1% claim.
- Cited from the papers without re-checking their tables: RAPTOR and A-MEM benchmark numbers, the Generative Agents decay constants, and Letta sleep-time agent internals. Nothing in the design depends on them.

Internal sources:
- [Librarian Doctrine](../LIBRARIAN-DOCTRINE.md)
- [E9-1 audit](E9-1-memory-structure-audit.md)
- evidence: [E9-2b](../evidence/epic9-e9-2b-2026-11-01.md), [E9-2d](../evidence/epic9-e9-2d-2026-11-02.md), [E9-2f](../evidence/epic9-e9-2f-2026-11-02.md), [E9-2g](../evidence/epic9-e9-2g-2026-11-02.md), [E9-2h](../evidence/epic9-e9-2h-2026-11-02.md), [E9-3b](../evidence/epic9-e9-3b-2026-11-02.md), [E9-3c](../evidence/epic9-e9-3c-2026-11-02.md)
- EpicSpine skill `references/` (spine-model, standing-spines, learnings, tree-cleanse) and `scripts/tree_audit.py`, `epic_log.py` (`STALE_DAYS = 14`)
- agent_team `docs/personas/delivery-manager.md`, `docs/personas/unblocker.md`, `personas/README.md`

## 10. Build plan (proposed rows)

| Row | What | Depends on | Done check |
|---|---|---|---|
| E9-5a | Tier-0 index: per-tenant SQLite FTS5 over pages, Log and roots, with lineage prefix and aliases; `search_memory` and ask_brain's first search use it; `zenod index rebuild` | none | right page in the top 5 for ≥ 9 of the 10 E9-3 eval questions; p95 < 50 ms; rebuild idempotent; $0 model; tenant isolation test |
| E9-5b | Stable identity and steering data: root ids matched across runs (Jaccard ≥ 0.5); `pinned`, `name-locked`, `aliases`; `## Keeper notes` in Tree.md; pin and rename in the Memory tab | E9-2i | on a fixture, a rename and a pin survive 3 re-derivations; a keep-apart note blocks a merge; lint 0 |
| E9-5c | Memory-keeper persona: daily light wake ($0) plus weekly digestion; change budget 3; NOOP default; `## Recent changes`; $0.05/week cap through the allowance; filing cost split out in the usage ledger | E9-5b | replay of Jordi's last 8 weeks on a clone: ≥ 80% of roots stable week to week, ≤ 3 changes a week, cost per run in the ledger; one commit per wake, revert byte-identical |
| E9-5d | Root "Now" lines and closure: model calls only for changed roots, citing Log anchors; Outcome line on close, then long-term | E9-5c | every working root has a dated, cited "Now" line; one closure end to end on a clone; weekly cost ≤ $0.05 measured |
| E9-5e | Steering by message: "pin X", "rename X to Y", "X is Y", "X is not Y", "that's wrong", "yes, close X" become Keeper notes or reverts | E9-5b | 6 phrasings parsed in tests (English and Spanish); one real steer from Jordi sticks over two weekly runs |
| E9-5f | EpicSpine gains: shared tree library (heat half-life, stable ids, recent-changes rollup) and a steward-persona reference page, upstreamed to epicspine-skill | none (skill repo) | skill PR merged; `spines.py --active` ranks by heat; Zenod has no runtime import of the skill |

Order: E9-5a and E9-5b in parallel → E9-5c → E9-5d and E9-5e. E9-5f runs alongside. E9-2i lands first, and its Agentine and Family findings become the first Keeper notes.

## 11. Decisions for Jordi (folded into one ask as defaults)

1. **Keeper autonomy.** *Default: it acts within a budget.* It makes up to 3 revertable changes a week on its own, each shown under Recent changes and undone by "that's wrong". The alternatives are proposals-only, where Jordi approves each change, or no budget.
   - Why: the Librarian Doctrine already lets the sweep re-derive roots on its own (E9-A4), and proposals-only would make the tree wait on him.
2. **Cadence and money.** *Default: a daily deterministic wake ($0) and a weekly digestion capped at $0.05*, at most about $0.22 per user per month (7% of $3). The alternative is nightly digestion, at about 7× the model cost.
   - Why: weekly matches how fast topics change, and the daily wake keeps the index and heat fresh for free.
3. **Index location.** *Default: a derived SQLite file in the tenant's data directory, not committed to the vault.* The alternative is to commit it into the vault.
   - Why: the vault stays his notes only, and the index can always be rebuilt from it.

## Proposed spine updates (for the steward; this run does not edit the spine)

E9-4 row: `| E9-4 | Research worker | worker run_f6565d0c | Digestion design deck … | done | E9-2h | - | main | [E9-4 design](epic9/E9-4-digestion-design.md), [deck](http://100.86.141.63:8854/) (18 slides; source epic9/E9-4-digestion-deck/): two loops (filing in seconds, weekly digestion by a memory-keeper persona, ≤ 3 changes/week, NOOP default, stable ids, Keeper notes for pins/renames/aliases), tier-0 SQLite FTS5 index with lineage ($0/query), cost ≈ $0.04–0.09/user/month (cap $0.22); 6 build rows E9-5a…5f proposed | 2026-11-02 | Jordi reviews the deck (E9-A6) |`

New rows (draft, waiting on E9-A6): E9-5a … E9-5f as in §10, Role `Ticket worker`, Status `draft`, Base `main`.

E9-A6 ask:
> Review the digestion deck: build it as proposed? (about 10 minutes)
> - **Context:** the deck answers your E9-A5 questions. Zenod files each capture in seconds and digests slowly. A memory-keeper wakes daily for free and weekly for under 5 cents. It makes at most 3 revertable changes a week, keeps your names stable, and obeys your pins, renames, aliases and "that's wrong". A free keyword index answers "where did I say…" instantly, with the path. Refining the tree costs under 10 cents per user per month.
> - **Impact:** yes readies six build rows (E9-5a…5f), starting with the index and stable names.
> - **Risk:** low. Every keeper change is one vault commit with the E9-2g/2h backup and revert routine, and the index is derived and deletable.
> - **Recommend:** yes, with three defaults: (1) the keeper acts within a 3-a-week budget rather than asking about each change; (2) a $0 daily wake plus a weekly digestion capped at $0.05; (3) the index lives beside your vault, not in it. Change any of them in one word.
> - **Why Jordi:** it sets how much Zenod may reorganise your memory on its own.
> - **Details:** [deck](http://100.86.141.63:8854/), [E9-4 design](epic9/E9-4-digestion-design.md)
