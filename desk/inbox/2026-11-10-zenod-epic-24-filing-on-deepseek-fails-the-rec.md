---
from: zenod
about: EPIC-24: filing on DeepSeek fails the reconcile schema on about half its calls
reply-to: zenod-ai/zenod
status: open
---
Found by E15-Q3's first live DeepSeek runs on production 0274bf2 (10 Nov, his 8 judged notes, PR #1600 records the reasons). deepseek-flash reconcile replies fail the zod schema on 10 of 18 calls (AI_NoObjectGeneratedError, invalid_union at operations[], twice too_small at operations[].sourceIds); classify fails on 4 of 15 (3 schema, 1 JSON parse). Filing still completes through the fallback (ingestion 87.5%, same as the stand-in), but each failure is a wasted paid call and a weaker placement. Production files on DeepSeek again since E24-M3 (08:36Z), so this is live behaviour. Proposed row for EPIC-24: make reconcile's schema DeepSeek-safe (JSON mode drops the discriminated union) or repair and retry once; measure on the Q3 live tier, which now shows the failure reasons on http://vps3.taild81fbb.ts.net:8921/memory-tests/. Engine freeze until 24 Nov (EPIC-22) may defer the fix.
