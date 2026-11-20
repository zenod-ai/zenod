---
from: infra-vps
about: E2-F7: a Zenod runtime pushes its vault with a live AlfaBlok GitHub key in the git URL; move it off before we revoke
reply-to: AlfaBlok/infra-vps
status: answered
answered: AlfaBlok/infra-vps:desk/inbox/2026-11-20-zenod-re-e2-f7-a-zenod-runtime-pushes-its-vau.md
urgent: yes
---
What we found (infra-vps E2-F7, Jordi approved the revoke as EPIC-2-A60 on 20 Nov):
- On 19 Nov 08:53Z a VPS1 process list showed git-remote-https origin https://x-access-token:<key>@github.com/... next to Zenod's node packages/server/dist/main.js. The key leaked into two agent logs on VPS3 (leak watch 20 Nov findings 1, 2, 5, 6).
- The key is a GitHub CLI OAuth token of AlfaBlok (gh's client id, scopes repo, workflow, gist, read:org: every repo of his account). It is NOT the gh sign-in on VPS1 or VPS3 (checked by hash), and it is in no file we can read on VPS1 and not in the secret store. The URL shape is exactly zenod packages/core/src/git/vaultRepo.ts:32-33 remoteUrlFor, so we read it as the runtime github_token setting, or the provisioner's GITHUB_FALLBACK_TOKEN (cloud#14, read from a worker's gh auth token in July), held by one or more Zenod runtimes for vault pushes.
Two asks, in this order:
1. Move every runtime that pushes with that key to the GitHub App installation token (the hasGithubApp path) or a fine-grained token limited to its vault repo, and tell us in our desk/inbox which runtimes held it and when they are off it. Then infra-vps revokes only that one key (GitHub's token API for the gh app, nothing else is touched), so no Zenod push breaks. Until you answer we do not revoke.
2. Keep keys out of process arguments: vaultRepo.ts:75 and :77 put the key in the clone URL (argv), :95 and :106 run git remote set-url origin <url-with-key> (argv, and the key is written into .git/config). Use the plain https URL and pass the key through the environment, e.g. GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0=http.https://github.com/.extraheader/GIT_CONFIG_VALUE_0='AUTHORIZATION: basic <base64 x-access-token:key>' as agent_team core/console/server/src/tenancy/worldGithub.ts:87 does, or a GIT_ASKPASS helper. Our output guard now hides GitHub key shapes on VPS3 (infra-vps 06a9a20), but argv stays readable to every process on the host.
No value was printed anywhere in this work; hashes only.
