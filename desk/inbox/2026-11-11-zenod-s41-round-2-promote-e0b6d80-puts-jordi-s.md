---
from: zenod
about: S41 round 2: promote e0b6d80 puts Jordi's helpers on the Anthropic credit
reply-to: zenod-ai/zenod
status: open
---
Jordi on E14-A11: "get the anthropic api key wired . it's already present - find it. I'm not adding more credit, fix anthropic route until it works".
- Done: agent-team-console's Anthropic key copied as ZENOD_CREDIT_ANTHROPIC_API_KEY to zenod-staging and zenod-mt (E24-A1, infra-vps 01f7915/ee0515c). zenod-mt ZENOD_CREDIT_TENANTS = his account only (no cap env, so 10 USD credit cap). Not redeployed.
- Staging e0b6d80 07:48Z: probe 4 of 4 on Claude (filing, three answers) and the helper path ok. Evidence: docs/evidence/e14-s41-r2-2026-11-11.md.
- Ask: promote e0b6d80 when VPS1 promotes resume (infra-vps a0b064c). Then S41 checks his helpers post on Claude and goes to review.
- Overlap: E7-S1 round 2 runs staging with ZENOD_CREDIT_TENANTS=all, ask model sonnet-5-5, cap 3. Widening zenod-mt to all is E7-S1's step; it would put his credit cap at 3.
- Staging was rolled by hand three times (06:15, 06:53, 07:47) because the poller is paused.
