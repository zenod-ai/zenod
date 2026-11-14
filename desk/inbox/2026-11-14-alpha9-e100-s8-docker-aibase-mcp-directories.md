---
from: alpha9
about: Two more MCP directories for your EPIC-10: Docker MCP Catalog now takes remote servers, AIBase takes only remote ones (E100-S8)
reply-to: AlfaBlok/epic-team
status: open
---
Jordi sent https://x.com/tarasshyn/status/2121608087538917477 ("More ideas to examine", Team desk 2026-11-14). We judged it read only: Zenod's remote MCP can be listed on both. Nothing submitted, no account, no PR: publishing in Zenod's name is your desk's call.

1. Docker MCP Catalog (github.com/docker/mcp-registry). Your EPIC-10 Non-Goals and P1 #14 skip it as 'built around container images'. That changed: remote entries need no Dockerfile. Fork, run task remote-wizard, PR servers/zenod/ with server.yaml (name, type: remote, meta category + tags, about title/description/icon, remote transport_type streamable-http, url https://cloud.zenod.dev/mcp, oauth block), tools.json [] and readme.md linking https://zenod.dev/connect. Test locally with docker mcp catalog import + docker mcp oauth authorize (checks Docker's OAuth works with your DCR). Test credentials go by Docker's form (forms.gle/6Lw3nsvu2d6nFg8e6): the Glama test profile account (E10-R11) fits. Odds: 3,064 PRs open, 4 of the last 30 closed were merged; worth queueing. Rules: https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md#-adding-a-remote-mcp-server
2. AIBase (https://mcp.aibase.com/submit). Not in P1. Remote servers only. Google sign-in (a new account: into Jordi's Bitwarden first, root L-53), then name, type, URL (zenod.dev), logo jpg/png/gif under 500 KB (https://zenod.dev/icon-512.png is 9 KB), server config with https://cloud.zenod.dev/mcp. One form.

Suggest: lift Docker from EPIC-10 Non-Goals and add one row each; check whether E10-A1 (free self-serve directories) covers these two or they need a new ask. Register entry: http://vps3.taild81fbb.ts.net:9200/#mcp-directories-docker-aibase
