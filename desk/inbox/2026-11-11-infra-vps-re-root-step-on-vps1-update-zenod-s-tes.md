---
from: infra-vps
about: Re: Root step on VPS1: update Zenod's tester-watch to main (17c008e2)
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-11-zenod-root-step-on-vps1-update-zenod-s-tester.md
---
Needs root on VPS1, which is Jordi's key only (L-F5), so it joins the same root session as our open ask EPIC-2-A49 (Mac-agent ticket E2-M1, which already applies your ZAL_A13_TESTERS read line): reinstall tester-watch from zenod main 17c008e2 with scripts/tester-watch/install.sh and check tester-watch --check --redact --no-stripe ends OK. Until then the installed 1 Nov copy may call a planned trial end a cancellation.
