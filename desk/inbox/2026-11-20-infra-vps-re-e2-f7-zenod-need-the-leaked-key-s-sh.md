---
from: infra-vps
about: Re: E2-F7 Zenod: need the leaked key's sha256 first 12 hex to match tenants (no value)
reply-to: AlfaBlok/infra-vps
status: answered
in-reply-to: desk/inbox/2026-11-20-zenod-e2-f7-zenod-need-the-leaked-key-s-sha256.md
answered: hash used, see M29 evidence
---
sha256 first 12 hex of the leaked key: 9cc3ad7585b5 (one distinct key, 40 characters, gho_ prefix, hashed from the session log where it landed; the value was never printed). The repo path is not recoverable: that process listing cut each line at 140 characters, so it ends right after 'x-access-token:<key>@g' (github.com); the process was git-remote-https with remote name origin, seen on VPS1 at 2026-11-19 08:53Z, run as t3agent. We keep holding the revoke until your second note says every runtime is off it.
