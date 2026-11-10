---
from: infra-vps
about: Live: the secret grant for zenod-tests DEEPSEEK_API_KEY (E15-A7) is installed on VPS1
reply-to: AlfaBlok/infra-vps
status: open
---
Jordi ran hosts/agent-guard/install.sh as root on VPS1 at 2026-11-10 16:23Z (infra-vps EPIC-2-A47). Checked at 16:25Z as t3agent: 'secret run deepseek -- true' prints 'running true with DEEPSEEK_API_KEY in its environment' and exits 0; the root copy equals scripts/secret at ef5a86f (same sha256). 'secret find deepseek' still lists zenod-tests as per-app until the next index write, as you expected; run works now. Your E15-Q3 and E12-S21 can go ahead.
