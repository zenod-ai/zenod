# Mechanical Capture — Ring conversation repair — 2026-07-30

Live acceptance candidate: `c0cb89abd1d1fc43bb59beabaa8b52a0d081f2b8`

Tenant: `github-63050995`

Result: the real WhatsApp follow-up completed without a timeout or duplicate memory. Ring asked one clarification because two voice-note tickets existed, then identified the requested terminal capture at `Log/2026-07-30.md#^e-1d0d28`, named `Inbox/needs-filing-2026-07-30T00-00-44.md`, and stated that no action was taken.

## Live replay

1. Sent `for now simply store the note into memory`.
2. Ring returned one clarification: `Which note? (Provide content or evidenceRef.)`, followed by the host-owned `Read-only answer — no action was performed.` status.
3. Replied `the latest voice note, evidence Log/2026-07-30.md#^e-1d0d28`.
4. Ring returned: `Logged: the note (Log/2026-07-30.md#^e-1d0d28) is already terminal-filed in Inbox/needs-filing-2026-07-30T00-00-44.md. No action taken.`, followed by the read-only status.
5. The remote Obsidian brain HEAD remained `ee4f948320d9f28c824fb171df609aed16c5ed48` before and after the replay, proving that this interaction created no new memory commit.

Screenshot: `live-whatsapp-clarification-and-terminal-answer.png`.

## Deployment and gates

- PR [#1030](https://github.com/zenod-ai/zenod/pull/1030) moved Ring's memory-job polling to MCP `get_task_result`, loaded typed terminal capture tickets, excluded legacy capture prose structurally, and required a verified store receipt before rendering mutation success.
- PR [#1031](https://github.com/zenod-ai/zenod/pull/1031) rendered the no-action terminal-capture response as typed `answer_content` plus a host-owned `read_only_status`, without changing `taskingPolicy.ts` or `replyGate.ts`.
- Full repository tests passed locally: Core 519 passed / 6 skipped; Server 879 passed; all app suites passed; scripts 194 passed; builds, typechecks, schemas, and the net-new lexical-policy diff check passed.
- The required independent D15/D19 review returned `APPROVE`.
- PR CI passed on its retry. The first run's only failure was the existing Ring authority test exceeding its 5-second timeout under CI load; it passed locally and on retry.
- Main image publish run [30536078337](https://github.com/zenod-ai/zenod/actions/runs/30536078337) passed runtime boot smoke.
- Public health for Phylax, Ring, and Zenod reported exact full SHA `c0cb89abd1d1fc43bb59beabaa8b52a0d081f2b8`; Phylax reported WhatsApp `connected/ready`.

## Preserved incident artifact

The failed pre-fix interaction created an unintended stale £97 fuel memory at `Log/2026-07-30.md#^e-454112`, commit `ee4f948320d9f28c824fb171df609aed16c5ed48`, page `Inbox/needs-filing-2026-07-30T00-02-22.md`. It was not deleted because cleanup was not authorized.
