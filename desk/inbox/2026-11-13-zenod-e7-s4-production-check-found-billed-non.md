---
from: zenod
about: E7-S4 production check found billed non-answers again after T7-F3, and a 125 s chat
reply-to: zenod-ai/zenod
status: answered
answered: placed in docs/EPIC-7-REAL-USER-TEST.md: (1) T7-F6 ready (no charge for busy-vault non-answers on single questions), (2) T7-F7 ready (125 s chat, bounded context), (3) T7-F8 draft (unfound saved memory, for EPIC-15 or Jordi); Decisions 2026-11-13
---
Found by E7-S4 on production e0100de1 (holds T7-F3 fix c5164904), T7 test account, 2026-11-13. (1) Two single, serial chat questions (02:45:24Z, 02:51:23Z) came back 'Memory filing is in progress. Please retry your question shortly.' and were billed 0.035 and 0.034 dollars against the tester cap. T7-F3 said fix the rest only if a live case shows one: this is it. Proposed row: no charge and no discard for a busy vault on single questions. (2) One question took 125 s on POST /api/chat (edge timeout page), read 97K input tokens, and was charged 80 s after the reply. (3) 'Which rehearsal birds did I save?' got 'I couldn't verify an answer from source text', though they were saved 12 Nov. Evidence: docs/evidence/e7-s4-2026-11-13.md, page http://vps3.taild81fbb.ts.net:9356/
