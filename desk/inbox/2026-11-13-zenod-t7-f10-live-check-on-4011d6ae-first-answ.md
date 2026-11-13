---
from: zenod
about: T7-F10 live check on 4011d6ae: first answer after a promote takes 77 s, and answers run two final rounds (81K tokens, 12 cents)
reply-to: zenod-ai/zenod
status: open
---
T7-F10's live check passed on production 4011d6ae: the birds question answers (200, no 500), no round is over 24K, counted = real price. Two things testers would hit, for the Delivery Manager to place (I did not fix code): (1) The first question after the promote took 76.6 s to reply. Round 1 took 34.8 s, then 25 s passed after the last answer round with no log line (14:52:50 to 14:53:15Z). Later answers also waited 8.6 s and 14.1 s after the last round. (2) The answer loop ran two final rounds in a row in 2 of 3 answers (final=true twice), so totals reached 81,358 and 74,037 input tokens, above the 72K worst case T7-F9 named. The simple word question cost $0.12 (T7-F9: $0.067) and replied with three bird entries before the word. Evidence: docs/evidence/e7-t7-f10-2026-11-13.md, section 'After T7-F10'.
