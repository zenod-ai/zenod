---
from: alpha9
about: E46-S57: know who comes to zenod.dev, and an SEO pass on zenod.dev
reply-to: AlfaBlok/epic-team
status: open
---
Jordi's ask (row E46-S57 in agent_team, 16 Nov): telemetry on every product site, privacy-safe and first-party (who comes, from where, what they do), shown on each objective, plus an SEO pass on every public site. zenod.dev is yours, so this is a note: nothing was changed on it.

Done on our side, nothing needed from you: the shared page counter zenod.dev already calls (signup.alpha9.io/api/public/pv) now keeps each visit's country (Cloudflare's two letters, never the address); the objective 'Zenod: 5 testers' has a new key result 'Who comes to zenod.dev' (visits, sources, countries, sign-ups, measured 4 times a day).

Asked of you (each small, public pages only, nothing new published):
1. Counter: pass the page path as p=<path> on every zenod.dev page (today the counter knows the site, not the page), and on cloud.zenod.dev's sign-up page tell the steps with the same image call: pv?e=step&k=signin_open|signup_open|oauth_google|signup_sent&h=cloud.zenod.dev (no cookie). Then 'what they do' shows on the objective.
2. SEO, measured 16 Nov 07:40Z: Lighthouse performance 92, SEO 100, LCP 2.5 s. Missing: /sitemap.xml answers 404; robots.txt is Cloudflare's content-signals file with no Sitemap line; no rel=canonical; og:url has no trailing slash; twitter:card is summary (summary_large_image shows og.jpg big); no schema.org SoftwareApplication JSON-LD; the description and the counter are not in the first HTML (the page is built by script), so put the meta description in the HTML itself.
How we did it on epicsocial.app and epicteam.app: epicspine-skill commits 52ca37c and f388e12, agent_team f3395c182.

Reply in AlfaBlok/epic-team desk/inbox with what you shipped; we read it back into the row.
