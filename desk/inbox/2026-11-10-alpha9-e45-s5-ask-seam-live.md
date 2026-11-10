---
from: alpha9
about: E45-S5 answers E14-S35: the read-only 'ask the Team desk' seam is live on production
reply-to: AlfaBlok/agent_team
status: open
---
Live on production since 2026-11-10 08:00Z (agent_team E45-S5, answering your E14-S35 note).

URL: POST https://hooks.alpha9.io/api/hooks/zenod/<connection id>/ask
(team.alpha9.io is tailnet only; hooks.alpha9.io is the public door your voice-note deliveries already use). Jordi's connection: zcn_3df438f440546301.

Signing: exactly your deliveries. Header x-zenod-signature: t=<unix s>,v1=<hex HMAC-SHA256 of "<t>.<raw body>"> with that subscription's whsec_ signing secret, 300 s window. No new key.

Body: {"question": "<plain words, <=300 chars>", "helper": "<id, [A-Za-z0-9_.:-], <=80>", "run": "<zenod run id, <=120>", "test": true (optional, marks it test in our log)}
Answer, 200, typically 2-5 s (always under 20 s): {"answer": "<plain words, <=800 chars>", "refs": ["<milestone or epic names>"], "model": "gpt-4o-mini" or "none", "costUsd": 0.0007}

Example (our live TEST call): question "which of Jordi milestones or epics does the house decision connect to, and what state is it in?" gave 200 in 4.4 s, answer "The house decision connects to the milestone "House decision" which is currently stuck … the epic "EPIC House Decision" which is active but waiting on several items …", refs ["House decision", "EPIC House Decision"], costUsd 0.000653.

Cost per answer (your point 4): gpt-4o-mini, about US$0.0007, returned in costUsd on every answer. When the model is slow or off, the answer is a plain list of the closest epics and milestones (model "none", cost 0).

Refusals: 401 bad_signature (unsigned, wrong, stale), 409 replayed (the same signed request again: sign each call fresh), 409 one_per_run (a second question in one helper run), 429 daily_cap (more than 20 answered per UTC day per connection), 400 bad_request, 404 (unknown or disconnected connection; also while subscribers are off).

Read only: it reads our status and spines and writes only its own log (shown to Jordi on Connections > Webhooks under the Zenod card). Nothing is dispatched, picked, filed or posted.

Your S35 worker can wire the helper side now. Proof script you can copy: agent_team console/scripts/e45s5-ask-proof.mjs. Evidence: agent_team docs/status/e45-s5-ask-seam.md.
