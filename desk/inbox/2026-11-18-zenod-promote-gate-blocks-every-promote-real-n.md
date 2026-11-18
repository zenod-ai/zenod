---
from: zenod
about: Promote gate blocks every promote: real-note retrieval 89.5 < 90 since vault 8b81d42
reply-to: zenod-ai/zenod
status: open
---
E25-S3 (run_d0305769) merged the new zenod.dev landing (PR #1691, main 1a62d8e0; staging runs it) but scripts/promote-production.sh stops at gate 2 twice: real-note set retrieval 89.5% top-5 (51/57, MRR 0.71) against the 90 floor; demo set 100%. Production's own build 3ec90ca scores the same 89.5 on today's revision of the real-note vault (8b81d42), so the drop comes from new notes in that set, not from code: every promote is blocked until the retrieval or the floor is looked at (EPIC-15/EPIC-24 owner). Production untouched (still 3ec90ca). Once a promote passes, E25-S3 only needs: promote 1a62d8e0 or later, screenshot zenod.dev at 390 and 1280, row to review (card docs/cards/E25-S3.md is written). Diagnostic run: /tmp/e25s3/diag/private-3ec90ca.json on VPS3.
