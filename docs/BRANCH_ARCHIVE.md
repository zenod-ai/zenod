# Branch Archive

Stale remote branches are not just deleted. Each one is first kept as an annotated tag `archive/<branch with / replaced by ->` at its tip, the tag is pushed and checked on origin, and only then is the remote branch deleted.
Tags never expire, so any branch can be restored.
To restore a branch, run the command in its row below.
To inspect without restoring, run `git fetch origin tag <tag>` then `git log <tag>`.

## Policy

- Branches of closed-unmerged PRs get archived.
- Branches that never had a PR get archived after more than 30 days idle with no worktree in use.
- Stale open PRs get a comment asking the owner to merge or close, and are archived 14 days after that if nobody responds.
- `codex/recovery-epic25-worktree-20260709` is a safety snapshot and is never archived.
- Nothing is force-pushed or rewritten.

## 2026-10-16 cleanup

| branch | archive tag | tip sha | last commit date | PR | why | restore command |
|---|---|---|---|---|---|---|
| `codex/gdv-spine-gdv11-complete` | `archive/codex-gdv-spine-gdv11-complete` | `263cbf1f3a6f4c4168ac9be32a966ff39d5327ec` | 2026-08-30 | [#1184](https://github.com/zenod-ai/zenod/pull/1184) (merged) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/codex-gdv-spine-gdv11-complete:refs/heads/codex/gdv-spine-gdv11-complete` |
| `epic2/h2-checkout-live` | `archive/epic2-h2-checkout-live` | `a3afca4ceb4e0d1693373af947859b1d506d5063` | 2026-07-04 | [#525](https://github.com/zenod-ai/zenod/pull/525) (merged) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/epic2-h2-checkout-live:refs/heads/epic2/h2-checkout-live` |
| `epic23-c2-handback` | `archive/epic23-c2-handback` | `0c45c4b3c2d851ae777a1e16c8a3ac5aad49faab` | 2026-07-05 | [#602](https://github.com/zenod-ai/zenod/pull/602) (merged) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/epic23-c2-handback:refs/heads/epic23-c2-handback` |
| `epic23-c3-docs` | `archive/epic23-c3-docs` | `784ed1955b2f1f058c11a6570bbbd735726f1b7e` | 2026-07-05 | [#609](https://github.com/zenod-ai/zenod/pull/609) (merged) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/epic23-c3-docs:refs/heads/epic23-c3-docs` |
| `epic23-c4-docs` | `archive/epic23-c4-docs` | `de69d6072f7a2a82e1197391090a7c76ac2cb090` | 2026-07-05 | [#610](https://github.com/zenod-ai/zenod/pull/610) (merged) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/epic23-c4-docs:refs/heads/epic23-c4-docs` |
| `epic23-c5-docs` | `archive/epic23-c5-docs` | `9c59a10d779e73ee45a1b0b8fc7ae0623f801205` | 2026-07-05 | [#612](https://github.com/zenod-ai/zenod/pull/612) (merged), [#613](https://github.com/zenod-ai/zenod/pull/613) (closed) | PR squash-merged, so the tip is not an ancestor of main; archived and deleted earlier on 2026-10-16 | `git push origin archive/epic23-c5-docs:refs/heads/epic23-c5-docs` |
| `codex/epic-3.2-live-pilot` | `archive/codex-epic-3.2-live-pilot` | `7d45d502434db91c2379d2298272af2455e276bf` | 2026-07-10 | [#785](https://github.com/zenod-ai/zenod/pull/785) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-epic-3.2-live-pilot:refs/heads/codex/epic-3.2-live-pilot` |
| `codex/gdv-4-vault-repository` | `archive/codex-gdv-4-vault-repository` | `c1923149f97c8c353194a6339114efec536ba2f8` | 2026-08-29 | [#1160](https://github.com/zenod-ai/zenod/pull/1160) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-gdv-4-vault-repository:refs/heads/codex/gdv-4-vault-repository` |
| `codex/production-opening-20260915` | `archive/codex-production-opening-20260915` | `0ec97e194f1d62f5416ee188ed291d8d573c727a` | 2026-09-16 | [#1312](https://github.com/zenod-ai/zenod/pull/1312) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-production-opening-20260915:refs/heads/codex/production-opening-20260915` |
| `codex/z-mt-1-chassis-reconcile` | `archive/codex-z-mt-1-chassis-reconcile` | `422d7a729d678af0c13f7b8040194b96f9cdb0ea` | 2026-07-10 | [#770](https://github.com/zenod-ai/zenod/pull/770) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-z-mt-1-chassis-reconcile:refs/heads/codex/z-mt-1-chassis-reconcile` |
| `codex/zls-html-sections` | `archive/codex-zls-html-sections` | `853aa1948c15462461bda43934cfc0c36c7c8849` | 2026-09-18 | [#1359](https://github.com/zenod-ai/zenod/pull/1359) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zls-html-sections:refs/heads/codex/zls-html-sections` |
| `codex/zls-section-01-html` | `archive/codex-zls-section-01-html` | `15cbf63a48a65261be56e85af3e733fb07dea1bd` | 2026-09-18 | [#1357](https://github.com/zenod-ai/zenod/pull/1357) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zls-section-01-html:refs/heads/codex/zls-section-01-html` |
| `codex/zls-slide-09` | `archive/codex-zls-slide-09` | `58a37d3b0f2672ef74d0e6903864f102be08d0d8` | 2026-09-18 | [#1347](https://github.com/zenod-ai/zenod/pull/1347) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zls-slide-09:refs/heads/codex/zls-slide-09` |
| `codex/zls-slide-retouches` | `archive/codex-zls-slide-retouches` | `0f7497137199229f141ec3dce4d866bdb2cad408` | 2026-09-18 | [#1350](https://github.com/zenod-ai/zenod/pull/1350) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zls-slide-retouches:refs/heads/codex/zls-slide-retouches` |
| `codex/zmr-33` | `archive/codex-zmr-33` | `ffb152521cdb2e41d8ddd104aa2c944f4a9658dc` | 2026-09-15 | [#1293](https://github.com/zenod-ai/zenod/pull/1293) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zmr-33:refs/heads/codex/zmr-33` |
| `codex/zmr-34` | `archive/codex-zmr-34` | `68d0b236af96c6c86cbbc90252f1675702c81a0d` | 2026-09-15 | [#1298](https://github.com/zenod-ai/zenod/pull/1298) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zmr-34:refs/heads/codex/zmr-34` |
| `codex/zmr-35` | `archive/codex-zmr-35` | `cd25d2443ebe3903b0429ccbf64359dd446b048b` | 2026-09-15 | [#1299](https://github.com/zenod-ai/zenod/pull/1299) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zmr-35:refs/heads/codex/zmr-35` |
| `codex/zmr-36` | `archive/codex-zmr-36` | `4b524e2d8f2b7773b90597f46c4c39a6a28fa20b` | 2026-09-15 | [#1297](https://github.com/zenod-ai/zenod/pull/1297) (closed unmerged) | PR closed unmerged | `git push origin archive/codex-zmr-36:refs/heads/codex/zmr-36` |
| `epic2/b6-placeholder-receipt` | `archive/epic2-b6-placeholder-receipt` | `3384d374da1be1dcd056aa6bfe34ef87242e0a6d` | 2026-07-04 | [#571](https://github.com/zenod-ai/zenod/pull/571) (closed unmerged) | PR closed unmerged | `git push origin archive/epic2-b6-placeholder-receipt:refs/heads/epic2/b6-placeholder-receipt` |
| `epic2/i2-8-b6-receipt` | `archive/epic2-i2-8-b6-receipt` | `2329cad2735940d5e5954ee0009f9ea808dbd247` | 2026-07-04 | [#569](https://github.com/zenod-ai/zenod/pull/569) (closed unmerged) | PR closed unmerged | `git push origin archive/epic2-i2-8-b6-receipt:refs/heads/epic2/i2-8-b6-receipt` |
| `codex/add-digest-architecture-slide` | `archive/codex-add-digest-architecture-slide` | `ee1d1de52061a4997a88ea313abd0810304755e0` | 2026-06-25 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-add-digest-architecture-slide:refs/heads/codex/add-digest-architecture-slide` |
| `codex/epic-3.2-integration-rebuild` | `archive/codex-epic-3.2-integration-rebuild` | `94d98fab81d202fbd5ba6f9b85037699f5116012` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-epic-3.2-integration-rebuild:refs/heads/codex/epic-3.2-integration-rebuild` |
| `codex/epic32-792-credential-migration` | `archive/codex-epic32-792-credential-migration` | `3878bdcfe6825b9359e462c989a4dea3a5600d72` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-epic32-792-credential-migration:refs/heads/codex/epic32-792-credential-migration` |
| `codex/urgent-voice-capture-restore` | `archive/codex-urgent-voice-capture-restore` | `e575522ae1eae1f85cc0ae946003436e240c27c3` | 2026-08-26 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-urgent-voice-capture-restore:refs/heads/codex/urgent-voice-capture-restore` |
| `codex/z-mt-2-vault-custody` | `archive/codex-z-mt-2-vault-custody` | `59c1b08a06ba9fee1fc62f48334b3af7e27a674c` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-z-mt-2-vault-custody:refs/heads/codex/z-mt-2-vault-custody` |
| `codex/z-mt-3-ui-panels` | `archive/codex-z-mt-3-ui-panels` | `21e9e46e2b8dedfb7326a6cef11cd8c386946e26` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-z-mt-3-ui-panels:refs/heads/codex/z-mt-3-ui-panels` |
| `codex/z-mt-4-migration` | `archive/codex-z-mt-4-migration` | `8a32b5dbb132cd2de66d655c9b54ccdd0b3ce7fd` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-z-mt-4-migration:refs/heads/codex/z-mt-4-migration` |
| `codex/z-mt-5-e2e` | `archive/codex-z-mt-5-e2e` | `1466be9204b79ab875efc2c06ce9d0325ed439ba` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-z-mt-5-e2e:refs/heads/codex/z-mt-5-e2e` |
| `codex/z-mt-6-cutover` | `archive/codex-z-mt-6-cutover` | `53fd7947a3b172952bb39640c32fdaefb937b9fd` | 2026-07-10 | none | never had a PR; idle >30 days; no worktree | `git push origin archive/codex-z-mt-6-cutover:refs/heads/codex/z-mt-6-cutover` |

## Kept for now

- `codex/recovery-epic25-worktree-20260709`: safety snapshot, kept on purpose.
- `codex/whatsapp-concurrent-voice-recovery`: never had a PR, but `docs/EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md` records it as a checkout with uncommitted work, so it may be in use on another machine.
- `codex/zmr-m2-production-tests`, `codex/zmr-m2-search-tests`: never had a PR, last commit 2026-09-16, which is right at the 30-day threshold; re-check later.
- Stale open PRs commented on 2026-10-16, with an archive deadline of 2026-10-30 if nobody responds: [#343](https://github.com/zenod-ai/zenod/pull/343), [#540](https://github.com/zenod-ai/zenod/pull/540), [#553](https://github.com/zenod-ai/zenod/pull/553), [#568](https://github.com/zenod-ai/zenod/pull/568), [#583](https://github.com/zenod-ai/zenod/pull/583).
- [#694](https://github.com/zenod-ai/zenod/pull/694) closed on 2026-10-16 as superseded by d19d6cf; its branch `codex/epic25-ring-cloud-test` is kept.
