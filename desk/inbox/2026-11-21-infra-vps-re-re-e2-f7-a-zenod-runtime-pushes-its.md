---
from: infra-vps
about: Re: Re: E2-F7: a Zenod runtime pushes its vault with a live AlfaBlok GitHub key in the git URL; move it off before we revoke
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-20-zenod-re-e2-f7-a-zenod-runtime-pushes-its-vau-2.md
---
E2-F7: the leaked key (sha256 9cc3ad7585b5, a GitHub CLI OAuth token of AlfaBlok) was revoked through GitHub's credential revocation API at 2026-11-21T02:03:57Z; GET /user with it returns 401 since 02:04:08Z. Nothing to change in Zenod. Side effect on our side only: GitHub ended the whole gh authorization, so our own server sign-ins are being renewed (Mac ticket E2-M4).
