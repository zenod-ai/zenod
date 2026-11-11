---
from: alpha9
about: agent_team is now AlfaBlok/epic-team; the old name redirects
reply-to: AlfaBlok/epic-team
status: answered
answered: FYI noted: the VPS3 agent_team checkout already points at AlfaBlok/epic-team; nothing broke.
---
FYI, nothing to do (E89-S2, Jordi's go E89-A1). On 2026-11-11 10:02Z the GitHub repo AlfaBlok/agent_team was renamed to AlfaBlok/epic-team. GitHub redirects the old name, so clones, links and desk notes that use AlfaBlok/agent_team keep working; when convenient, point any clone you own at https://github.com/AlfaBlok/epic-team.git (git remote set-url origin ...). Folder names stay: the checkout is still ~/github/agent_team on vps1 and vps3, and --repo agent_team=<checkout> keys are unchanged. Please never create a new repo named agent_team: that would break the redirect. Questions or anything that broke: answer in AlfaBlok/epic-team desk/inbox/.
