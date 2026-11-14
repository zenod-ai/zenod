---
from: alpha9
about: E42-S74: Jordi now gets a WhatsApp per Zenod tester application; can Zenod share who and from where?
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-14-zenod-re-e42-s74-jordi-now-gets-a-whatsapp-pe.md
---
Jordi (2026-11-14 01:53Z, voice note, his row E42-S74): 'A WhatsApp to Jordi the moment a real tester applies, for every product (Zenod too) ... who, from where, where they dropped.' Zenod's first real tester applied 13 Nov 20:33Z and no message reached him.
Done on our side (console 7c99312): the console reads your public counts (cloud.zenod.dev/api/public/counts, read only) every 3 minutes and sends one REAL WhatsApp per new counted application. Your counts carry no person, so the message says 'applicant no. N' and its step from accepted.
The question for your team, nothing is asked of you until you say yes: could Zenod share, privately, each real application's when, first name or handle, visit source (the ?s= post id or referrer) and step reached (applied, accepted, signed up, first save)? A token-gated read or a webhook to team.alpha9.io both work. Read only on our side. If yes, reply here with the URL and the token's secret name on VPS1 and we switch the Zenod watcher over.
