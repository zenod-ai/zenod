# Capture first, file always, curate later — acceptance evidence

Date: 2026-07-30
Base: `b165e262a78b32a0f467da0f002826f4a7ce13dc`
Branch: `capture-first-filing`

## Commit map

- Receipt contract: `e117f19` — `capture-first: make store receipts non-blocking`
- Uncertain-filing block: `bdcc410` — `capture-first: file uncertain captures to candidate pages`
- Skill, tool prose, and acceptance record: this commit — `capture-first: make later curation voluntary`

## Acceptance: explicit stores terminate with saved, non-question receipts

The required phrase sweep has no matches. `grep` exits 1 when it finds
nothing.

```console
$ grep -rn "QUESTION FOR THE USER" packages; printf 'grep_exit=%s\n' "$?"
grep_exit=1
```

The only production reads of a legacy receipt `question` are the three inbound
normalizers named in the spec. The other two matches are reads from the
classifier result, whose question is persisted in the vault.

```console
$ rg -n "\.question\b" packages/core/src packages/server/src --glob '*.ts' --glob '!**/*.test.ts'
packages/server/src/storageReceipt.ts:30:    : typeof v.question === "string"
packages/core/src/engine/engine.ts:1231:          classification.question ?? "Where should this memory be filed? I could not classify it confidently.";
packages/core/src/engine/engine.ts:1260:            classification.question ?? "Where should this memory be filed? I could not classify it confidently.";
packages/server/src/peerClient.ts:479:    : typeof receipt.question === "string"
packages/server/src/phylaxChannels.ts:735:    : typeof payload.question === "string"
```

Every receipt-rendering surface branches on `filing`.

```console
$ rg -n 'filing === "(uncertain|inbox|pending)"' packages/core/src/cli.ts packages/core/src/llm/aisdk.ts packages/server/src/mcp.ts packages/server/src/peerClient.ts packages/server/src/storageReceipt.ts packages/server/src/ingestQueue.ts packages/server/src/whatsappGateway.ts packages/server/src/phylaxChannels.ts
packages/server/src/phylaxChannels.ts:756:      ...(filing === "uncertain"
packages/server/src/phylaxChannels.ts:758:        : filing === "inbox"
packages/server/src/whatsappGateway.ts:1987:      stored?.filing === "uncertain"
packages/server/src/whatsappGateway.ts:1989:        : stored?.filing === "inbox"
packages/server/src/ingestQueue.ts:198:        step: stored.filing === "uncertain"
packages/server/src/ingestQueue.ts:200:          : stored.filing === "inbox"
packages/server/src/storageReceipt.ts:54:    if (stored.filing === "uncertain") {
packages/server/src/storageReceipt.ts:56:    } else if (stored.filing === "inbox") {
packages/server/src/storageReceipt.ts:59:      lines.push(stored.filing === "pending" ? "Filing pending." : "Saved.");
packages/core/src/cli.ts:200:      if (result.filing === "uncertain") {
packages/core/src/cli.ts:202:      } else if (result.filing === "inbox") {
packages/core/src/cli.ts:205:        console.log(result.filing === "pending" ? "Filing pending." : "Saved.");
packages/server/src/peerClient.ts:510:        const message = receipt.filing === "uncertain"
packages/server/src/peerClient.ts:512:          : receipt.filing === "inbox"
packages/server/src/peerClient.ts:514:            : receipt.filing === "pending"
packages/core/src/llm/aisdk.ts:917:                ...(result.filing === "uncertain"
packages/core/src/llm/aisdk.ts:919:                  : result.filing === "inbox"
packages/server/src/mcp.ts:393:  const status = result.filing === "uncertain"
packages/server/src/mcp.ts:395:    : result.filing === "inbox"
packages/server/src/mcp.ts:397:      : result.filing === "pending"
```

## Acceptance: one store of each filing kind and search by content/tag

This replay uses the built production engine against a temporary Git-backed
vault. The fake classifier is deterministic; storage, page writes, lint,
immutability checks, commits, receipts, and search are the real implementation.

```console
$ node --input-type=module <<'NODE'
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { createEngine } from './packages/core/dist/engine/engine.js';
import { VaultRepo } from './packages/core/dist/git/vaultRepo.js';
import { SqliteStateStore } from './packages/core/dist/state/sqlite.js';

const root = await mkdtemp(join(tmpdir(), 'capture-first-acceptance-'));
let state;
try {
  const bare = join(root, 'origin.git');
  await simpleGit().init(['--bare', '--initial-branch=main', bare]);
  const seed = join(root, 'seed');
  await simpleGit().clone(bare, seed);
  await cp('./packages/core/test/fixtures/vault', seed, { recursive: true });
  const seedGit = simpleGit(seed);
  await seedGit.addConfig('user.name', 'acceptance').addConfig('user.email', 'acceptance@test');
  await seedGit.add(['-A']);
  await seedGit.commit('seed');
  await seedGit.push('origin', 'main');
  const repo = await VaultRepo.open({ workdir: join(root, 'work'), remoteUrl: bare });
  state = new SqliteStateStore(':memory:');
  const llm = {
    async classify({ content }) {
      if (content.includes('no candidate')) return { confidence: 0.3, summary: 'no candidate', tags: [], pages: [], question: 'Where should this be filed?' };
      if (content.includes('ambiguous')) return { confidence: 0.3, summary: 'ambiguous candidate', tags: ['insurance'], pages: [{ path: 'Areas/Insurance.md', action: 'update', title: 'Insurance' }], question: 'Is this really about insurance?' };
      return { confidence: 0.95, summary: 'confident insurance', tags: ['insurance'], pages: [{ path: 'Areas/Insurance.md', action: 'update', title: 'Insurance' }] };
    },
    async composePage(input) { return `${input.currentContent.trimEnd()}\n\n- Acceptance capture (${input.citation}).\n`; },
    async answer() { return { text: '', readPaths: [] }; },
    async extractBacklog() { return { candidates: [] }; },
    async work() { return { text: '' }; },
  };
  const engine = createEngine({ repo, state, llm, location: { repo: 'zenod-ai/acceptance' } });
  for (const [kind, content] of [
    ['confident', 'acceptance confident insurance memory'],
    ['uncertain-with-candidates', 'acceptance ambiguous filing memory'],
    ['no-candidates', 'acceptance no candidate filing memory'],
  ]) {
    const receipt = await engine.store({ content, source: 'mcp' });
    console.log(`${kind}: ${JSON.stringify(receipt)}`);
  }
  console.log(`search_memory acceptance ambiguous: ${JSON.stringify(await engine.search('acceptance ambiguous'))}`);
  console.log(`search_memory filing/uncertain: ${JSON.stringify(await engine.search('filing/uncertain'))}`);
} finally {
  state?.close();
  await rm(root, { recursive: true, force: true });
}
NODE
(node:22341) ExperimentalWarning: SQLite is an experimental feature and might change at any time
confident: {"evidenceRef":"Log/2026-07-30.md#^e-f56aa2","evidenceUrl":"https://github.com/zenod-ai/acceptance/blob/75ca80eed652a01829d015a97bce01a2c8264cfa/Log/2026-07-30.md#L3","pagesTouched":["Areas/Insurance.md"],"pageUrls":["https://github.com/zenod-ai/acceptance/blob/75ca80eed652a01829d015a97bce01a2c8264cfa/Areas/Insurance.md"],"commitSha":"75ca80eed652a01829d015a97bce01a2c8264cfa","githubUrls":["https://github.com/zenod-ai/acceptance/blob/main/Log/2026-07-30.md","https://github.com/zenod-ai/acceptance/blob/main/Areas/Insurance.md"],"filing":"filed"}
uncertain-with-candidates: {"evidenceRef":"Log/2026-07-30.md#^e-1a4d5d","evidenceUrl":"https://github.com/zenod-ai/acceptance/blob/1ad1a91bb2099f0e1e1ee6e43ad941a305baa377/Log/2026-07-30.md#L9","pagesTouched":["Areas/Insurance.md"],"pageUrls":["https://github.com/zenod-ai/acceptance/blob/1ad1a91bb2099f0e1e1ee6e43ad941a305baa377/Areas/Insurance.md"],"commitSha":"1ad1a91bb2099f0e1e1ee6e43ad941a305baa377","githubUrls":["https://github.com/zenod-ai/acceptance/blob/main/Log/2026-07-30.md","https://github.com/zenod-ai/acceptance/blob/main/Areas/Insurance.md"],"filing":"uncertain"}
no-candidates: {"evidenceRef":"Log/2026-07-30.md#^e-b209d5","evidenceUrl":"https://github.com/zenod-ai/acceptance/blob/499d15abf0ed7782f53768af5a2eeee536324b20/Log/2026-07-30.md#L15","pagesTouched":["Inbox/needs-filing-2026-07-30T15-47-58.md"],"pageUrls":["https://github.com/zenod-ai/acceptance/blob/499d15abf0ed7782f53768af5a2eeee536324b20/Inbox/needs-filing-2026-07-30T15-47-58.md"],"commitSha":"499d15abf0ed7782f53768af5a2eeee536324b20","githubUrls":["https://github.com/zenod-ai/acceptance/blob/main/Log/2026-07-30.md","https://github.com/zenod-ai/acceptance/blob/main/Inbox/needs-filing-2026-07-30T15-47-58.md"],"filing":"inbox"}
search_memory acceptance ambiguous: [{"path":"Log/2026-07-30.md","snippet":"## 17:47 acceptance confident insurance memory  ^e-f56aa2","score":27,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Log/2026-07-30.md"},{"path":"Areas/Insurance.md","snippet":"- Acceptance capture ([[2026-07-30#^e-f56aa2]]).","score":23,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Areas/Insurance.md"},{"path":"Inbox/needs-filing-2026-07-30T15-47-58.md","snippet":"acceptance no candidate filing memory","score":1,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Inbox/needs-filing-2026-07-30T15-47-58.md"}]
search_memory filing/uncertain: [{"path":"Areas/Insurance.md","snippet":"#filing/uncertain","score":17,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Areas/Insurance.md"},{"path":"Log/2026-07-30.md","snippet":"## 17:47 acceptance ambiguous filing memory  ^e-1a4d5d","score":4,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Log/2026-07-30.md"},{"path":"Inbox/needs-filing-2026-07-30T15-47-58.md","snippet":"status: needs-filing","score":2,"githubUrl":"https://github.com/zenod-ai/acceptance/blob/main/Inbox/needs-filing-2026-07-30T15-47-58.md"}]
```

The three receipts contain `filing: "filed"`, `"uncertain"`, and `"inbox"`
respectively, and none has a `question` property. Both searches return
`Areas/Insurance.md`; the tag query's matching snippet is exactly
`#filing/uncertain`.

## Acceptance: uncertainty block is lint-clean and removable

The focused engine replay covers confident store, uncertain candidate store,
no-candidate Inbox fallback, compose-failure Inbox fallback, search by content
and tag, lint after append, and lint after deleting the complete uncertainty
section.

```console
$ env -u GITHUB_TOKEN -u GH_TOKEN npm exec vitest run --workspace packages/core -- test/engine.test.ts -t "stores a memory: evidence entry|low confidence with a candidate|low confidence without candidates|falls back to Inbox after exhausting retries" --reporter=verbose
✓ test/engine.test.ts > BrainEngine > stores a memory: evidence entry, meaning page, lint-clean commit (DoD #1 shape)
✓ test/engine.test.ts > BrainEngine > low confidence with a candidate appends a searchable, removable, lint-clean uncertainty block (DoD #6)
✓ test/engine.test.ts > BrainEngine > low confidence without candidates lands as an Inbox stub
✓ test/engine.test.ts > BrainEngine > falls back to Inbox after exhausting retries — never half-applies

Test Files  1 passed (1)
     Tests  4 passed | 49 skipped (53)
```

## Acceptance: legacy normalization and tombstones

```console
$ rg -n 'not\.toHaveProperty\("question"\)' packages/core/test/engine.test.ts packages/server/test/mcp.test.ts
packages/core/test/engine.test.ts:397:    expect(result).not.toHaveProperty("question");
packages/core/test/engine.test.ts:439:    expect(result).not.toHaveProperty("question");
packages/core/test/engine.test.ts:470:    expect(result).not.toHaveProperty("question");
packages/server/test/mcp.test.ts:479:    expect(stored).not.toHaveProperty("question");
packages/server/test/mcp.test.ts:485:    expect(unsure).not.toHaveProperty("question");
```

```console
$ env -u GITHUB_TOKEN -u GH_TOKEN npm exec vitest run --workspace packages/server -- test/mcp.test.ts -t "search_memory and store_memory round-trip" --reporter=verbose
✓ test/mcp.test.ts > MCP endpoint > search_memory and store_memory round-trip

Test Files  1 passed (1)
     Tests  1 passed | 27 skipped (28)
```

```console
$ env -u GITHUB_TOKEN -u GH_TOKEN npm exec vitest run --workspace packages/server -- test/phylaxChannels.test.ts test/storageReceipt.test.ts --reporter=verbose
✓ test/storageReceipt.test.ts > formatStorageReceipt > normalizes a legacy question receipt to a saved Inbox disposition without relaying its prose
✓ test/phylaxChannels.test.ts > PhylaxChannelsOrgan > dispatches a tenant voice binding mechanically, validates its live schema, and polls to a terminal receipt

Test Files  2 passed (2)
     Tests  53 passed (53)
```

## Acceptance: typecheck and full suite

```console
$ env -u GITHUB_TOKEN -u GH_TOKEN npm run typecheck
> typecheck
> npm run build -w zenod && npm run build -w @zenod/mcp-chassis && npm run typecheck --workspaces --if-present
> zenod@0.0.1 build
> @zenod/mcp-chassis@0.0.1 build
> zenod@0.0.1 typecheck
> @zenod/mcp-chassis@0.0.1 typecheck
> @zenod/server@0.0.1 typecheck
> calli-site@0.0.1 typecheck
> calli-web@0.0.1 typecheck
> herald-site@0.0.1 typecheck
> phylax-site@0.0.1 typecheck
> ring-site@0.0.1 typecheck
> site@0.0.1 typecheck
> web@0.0.1 typecheck
exit=0
```

The full command was run with both injected GitHub token variables cleared;
the console output was captured only to make the complete workspace summary
readable here.

```console
$ capture_first_log=/tmp/zenod-capture-first-npm-test.log; env -u GITHUB_TOKEN -u GH_TOKEN npm test >"$capture_first_log" 2>&1; capture_first_status=$?; rg "Test Files|Tests  |# tests |# pass |OK: [0-9]+ per-tool schemas" "$capture_first_log"; printf 'exit=%s\n' "$capture_first_status"
 Test Files  30 passed (30)
      Tests  523 passed | 6 skipped (529)
 Test Files  10 passed (10)
      Tests  89 passed (89)
 Test Files  92 passed (92)
      Tests  881 passed (881)
 Test Files  1 passed (1)
      Tests  5 passed (5)
 Test Files  1 passed (1)
      Tests  3 passed (3)
 Test Files  1 passed (1)
      Tests  5 passed (5)
 Test Files  1 passed (1)
      Tests  6 passed (6)
 Test Files  1 passed (1)
      Tests  5 passed (5)
 Test Files  1 passed (1)
      Tests  5 passed (5)
 Test Files  8 passed (8)
      Tests  42 passed (42)
# tests 194
# pass 194
OK: 27 per-tool schemas bundled and self-contained (no files written).
exit=0
```

## Post-merge deployment and live MT replay

PR [#1042](https://github.com/zenod-ai/zenod/pull/1042) merged to `main` as
`10f60835c383d0f5ea71a962c414410fb4582b8f`. The normal `Publish image`
workflow built, smoke-tested, and pushed the immutable
`ghcr.io/zenod-ai/zenod:sha-10f6083` image.

```console
$ gh run view 30559261176 --repo zenod-ai/zenod --json databaseId,displayTitle,headSha,status,conclusion,url,workflowName --jq '{databaseId,workflowName,displayTitle,headSha,status,conclusion,url}'
{"conclusion":"success","databaseId":30559261176,"displayTitle":"capture-first: file always, curate later; remove blocking store quest…","headSha":"10f60835c383d0f5ea71a962c414410fb4582b8f","status":"completed","url":"https://github.com/zenod-ai/zenod/actions/runs/30559261176","workflowName":"Publish image"}
```

Zenod MT, Ring, and Phylax were updated and deployed through Dokploy's
`application.update` and `application.deploy` API. All existing environment
and service settings were preserved. The persisted `GIT_SHA` override was
updated with the image so `/api/health` reports the running release rather
than the previous release.

```console
$ DOKPLOY_SAVED_TOKEN=$(jq -r .token /Users/jordi/.npm/_npx/bf18c59539a3b7e3/node_modules/@dokploy/cli/config.json); for app_id in 2dkayH_eAur427leH64MT hkdStWh6zfJ9d-uohdJHt urbFsgl6eImbQ4MTIZl5N; do curl -fsS -H "x-api-key: $DOKPLOY_SAVED_TOKEN" "https://dokploy.polyqu.com/api/application.one?applicationId=$app_id" | jq -r '[.name,.applicationStatus,.dockerImage,((.env // "")|split("\n")|map(select(startswith("GIT_SHA=")))|join(","))]|@tsv'; done
zenod-mt	done	ghcr.io/zenod-ai/zenod:sha-10f6083	GIT_SHA=10f60835c383d0f5ea71a962c414410fb4582b8f
ring	done	ghcr.io/zenod-ai/zenod:sha-10f6083	GIT_SHA=10f60835c383d0f5ea71a962c414410fb4582b8f
phylax	done	ghcr.io/zenod-ai/zenod:sha-10f6083	GIT_SHA=10f60835c383d0f5ea71a962c414410fb4582b8f
```

The three public health surfaces all reported the exact merge SHA before the
live replay.

```console
$ for url in https://cloud.zenod.dev/api/health https://ring.zenod.dev/api/health https://phylax.zenod.dev/api/health; do printf '%s\t' "$url"; curl -fsS -H 'Cache-Control: no-cache' "$url?evidence=capture-first-10f6083" | jq -c '{status,name,sha}'; done
https://cloud.zenod.dev/api/health	{"status":"ok","name":"zenod","sha":"10f60835c383d0f5ea71a962c414410fb4582b8f"}
https://ring.zenod.dev/api/health	{"status":"ok","name":"ring","sha":"10f60835c383d0f5ea71a962c414410fb4582b8f"}
https://phylax.zenod.dev/api/health	{"status":"ok","name":"phylax","sha":"10f60835c383d0f5ea71a962c414410fb4582b8f"}
```

Exactly one live ambiguous `store_memory` call was made through the Zenod MT
surface. The accepted ticket was polled; the store call was not retried.

```json
{
  "tool": "zenod_mt.store_memory",
  "input": {
    "content": "Capture-first production replay, 2026-07-30: the blue cedar should stay near the north room, or perhaps the archive; preserve this memory without deciding which context it belongs to.",
    "idempotencyKey": "capture-first-live-2026-07-30-10f6083",
    "verbatim": true
  },
  "accepted": {
    "ticket_id": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
    "jobId": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
    "kind": "store",
    "status": "queued",
    "state": "accepted",
    "poll": {
      "name": "get_task_result",
      "inputField": "ticket_id"
    }
  }
}
```

The exact terminal MT text receipt was:

```text
Saved — filed to Inbox; the filing question is logged in the note.
evidence: Log/2026-07-30.md#^e-aa9b9d
evidence URL: https://github.com/AlfaBlok/obsidian-brain/blob/c31dd498927fda0800129d1a85375f7b36a8f97e/Log/2026-07-30.md#L98
pages: Inbox/needs-filing-2026-07-30T16-15-18.md
commit: c31dd498927fda0800129d1a85375f7b36a8f97e
https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-07-30.md
https://github.com/AlfaBlok/obsidian-brain/blob/main/Inbox/needs-filing-2026-07-30T16-15-18.md
```

The exact terminal structured receipt was:

```json
{
  "found": true,
  "ticket_id": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
  "jobId": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
  "kind": "store",
  "status": "done",
  "state": "done",
  "result": {
    "evidenceRef": "Log/2026-07-30.md#^e-aa9b9d",
    "evidenceUrl": "https://github.com/AlfaBlok/obsidian-brain/blob/c31dd498927fda0800129d1a85375f7b36a8f97e/Log/2026-07-30.md#L98",
    "pagesTouched": [
      "Inbox/needs-filing-2026-07-30T16-15-18.md"
    ],
    "pageUrls": [
      "https://github.com/AlfaBlok/obsidian-brain/blob/c31dd498927fda0800129d1a85375f7b36a8f97e/Inbox/needs-filing-2026-07-30T16-15-18.md"
    ],
    "commitSha": "c31dd498927fda0800129d1a85375f7b36a8f97e",
    "githubUrls": [
      "https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-07-30.md",
      "https://github.com/AlfaBlok/obsidian-brain/blob/main/Inbox/needs-filing-2026-07-30T16-15-18.md"
    ],
    "filing": "inbox"
  },
  "evidence": [
    {
      "kind": "memory_stored",
      "id": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
      "ticket_id": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
      "jobId": "651203f3-db06-46bd-b7fb-cfc1f7ee92a4",
      "status": "done",
      "evidenceRef": "Log/2026-07-30.md#^e-aa9b9d",
      "url": "https://github.com/AlfaBlok/obsidian-brain/blob/c31dd498927fda0800129d1a85375f7b36a8f97e/Log/2026-07-30.md#L98",
      "commitSha": "c31dd498927fda0800129d1a85375f7b36a8f97e",
      "pagesTouched": [
        "Inbox/needs-filing-2026-07-30T16-15-18.md"
      ],
      "githubUrls": [
        "https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-07-30.md",
        "https://github.com/AlfaBlok/obsidian-brain/blob/main/Inbox/needs-filing-2026-07-30T16-15-18.md"
      ],
      "pageUrls": [
        "https://github.com/AlfaBlok/obsidian-brain/blob/c31dd498927fda0800129d1a85375f7b36a8f97e/Inbox/needs-filing-2026-07-30T16-15-18.md"
      ]
    }
  ]
}
```

The terminal text starts with `Saved`, contains no interrogative, and the
structured receipt has no `question` property. No rollback was required.
