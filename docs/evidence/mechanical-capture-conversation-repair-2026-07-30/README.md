# Mechanical Capture — Ring conversation repair — 2026-07-30

Live acceptance candidate: `bc218baa74c37ee63c03948a8349b7694381365a`

Tenant: `github-63050995`

Result: normal WhatsApp voice-note capture and conversation passed end to end. A fresh voice note produced one terminal Zenod memory at `Log/2026-07-30.md#^e-a96277`; two natural follow-up questions cited that exact note, the second conversational turn rendered one read-only status, and neither read created another memory commit.

## Final normal-operation lap

1. Baseline remote brain HEAD: `c8074aea098601f53e9515998293673e946b8361`.
2. Sent a fresh 27-second WhatsApp voice note: code phrase “Silver Orchard 4”; next action “verify the capture ledger on Tuesday.”
3. Immediate queued acknowledgement arrived, followed by terminal receipt commit `3be6837a9c1464f0c5959d32f9a1825ce2e5a6a7`, filed page `Projects/Zenod.md`, and evidence `Log/2026-07-30.md#^e-a96277`.
4. Asked: “What was the code phrase and the next action in the voice note I just sent? Please cite the evidence.” Ring returned the exact phrase and action with `^e-a96277` and one read-only status.
5. Asked: “And which day did I say to do it? Answer from that same note and cite it.” Ring returned “Tuesday,” cited `^e-a96277`, and rendered one read-only status.
6. The remote brain HEAD remained `3be6837a9c1464f0c5959d32f9a1825ce2e5a6a7` after both questions: exactly one capture commit and zero read-side writes.
7. Phylax outbox provider message `3EB053454F29217F7E377B`, job `5f84b311-6ec8-478e-a90d-d9772c229d1a`, was terminal and delivered with `last_error=null`. Ring's newest capture ticket matched that provider message and exact evidence ref.

Screenshots:

- `final-clean-lap-terminal-receipt.png`
- `final-clean-lap-grounded-conversation.png`

Preserved earlier-lap screenshots:

- `fresh-voice-note-terminal-receipt.png` — the first fresh capture whose follow-up selected stale context.
- `clean-lap-voice-note-terminal-receipt.png` — the `^e-9ce34e` capture after the current-capture fix.
- `clean-lap-grounded-follow-up.png` — correct first recall before the second-turn duplicate-status defect was found.

## Final fixes

- PR [#1032](https://github.com/zenod-ai/zenod/pull/1032) presents the newest terminal ticket as typed `currentCapture`, so current/just-sent follow-ups use its exact evidence ref instead of an older conversation capture.
- PR [#1033](https://github.com/zenod-ai/zenod/pull/1033) consumes typed `answer_content` at Ring's peer boundary and forwards only answer text plus sources to the model. The typed `read_only_status` remains host-owned and renders once.
- Neither fix adds lexical policy, output scanning, regex, stripping, or replacement. `taskingPolicy.ts` and `replyGate.ts` remain untouched.

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
- PR #1033 local gates passed: focused regression 14/14, Server 880/880, Core 519 passed / 6 skipped, and server typecheck. The net-new lexical-policy diff check was clean; the single independent D15/D19 review returned `APPROVE`.
- PR #1033 CI run [30538758538](https://github.com/zenod-ai/zenod/actions/runs/30538758538) passed. Main publish run [30538985609](https://github.com/zenod-ai/zenod/actions/runs/30538985609) passed runtime boot smoke and pushed `sha-bc218ba`.
- Zenod, Ring, and Phylax all reported exact full SHA `bc218baa74c37ee63c03948a8349b7694381365a`. Phylax reported WhatsApp `connected`, receive path `ready`, generation 1, no outage, and no restart required.
- Full repository tests passed locally: Core 519 passed / 6 skipped; Server 879 passed; all app suites passed; scripts 194 passed; builds, typechecks, schemas, and the net-new lexical-policy diff check passed.
- The required independent D15/D19 review returned `APPROVE`.
- PR CI passed on its retry. The first run's only failure was the existing Ring authority test exceeding its 5-second timeout under CI load; it passed locally and on retry.
- Main image publish run [30536078337](https://github.com/zenod-ai/zenod/actions/runs/30536078337) passed runtime boot smoke.
- Public health for Phylax, Ring, and Zenod reported exact full SHA `c0cb89abd1d1fc43bb59beabaa8b52a0d081f2b8`; Phylax reported WhatsApp `connected/ready`.

## Preserved incident artifact

The failed pre-fix interaction created an unintended stale £97 fuel memory at `Log/2026-07-30.md#^e-454112`, commit `ee4f948320d9f28c824fb171df609aed16c5ed48`, page `Inbox/needs-filing-2026-07-30T00-02-22.md`. It was not deleted because cleanup was not authorized.
