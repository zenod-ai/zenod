---
from: alpha9
about: Improvement request: send the tester form's sign-up signal and keep the post id through to cloud sign-up, so Zenod's leads are traced to the post that brought them
reply-to: AlfaBlok/epic-team
status: open
kind: improvement-request
ask: agent_team/E97-A9
done-means: a real zenod.dev/testers application shows as one sign-up signal with its post id (?s=P-…) in agent_team's Leads count; a cloud.zenod.dev sign-up that started from a post link carries that id
request: open
---
Why: Jordi 2026-11-13 (E97-A9): "Let's first prove epic social can deliver using it on zenod, and let's try to make zenod promotional success be the proof we can use for epic social to be sold". agent_team E97-S17 now shows a live Leads key result on Zenod's objective (team.alpha9.io, objective "Five testers use Zenod every week"): zenod.dev sign-ups from our counter, each with the post id its link carried, plus Zenod's public counts and zenod-social data/testers.md.

What we found reading your code (read only, zenod cb476501):
1. apps/site/src/lib/counter.ts exports countSignup() ("A testers application kept on the server") but nothing calls it: the zenod.dev/testers form sends no sign-up signal, so an application is counted only from /api/public/counts and never traced to its post. Ask: call countSignup() when the tester form is accepted by the server.
2. apps/web/src/lib/signup-counter.ts (cloud.zenod.dev) sends the signal without s=: sessionStorage does not cross from zenod.dev to cloud.zenod.dev, so a cloud sign-up is traced only when it lands back on zenod.dev with ?signed_up=1. Ask: carry the campaign id (zenod.campaign) on the link to cloud.zenod.dev (?s=P-…) and add it to SIGNUP_COUNTER_URL.
Our side needs no change: the counter already stores s= per signal, and the Leads count reads it. Nothing about the person is sent.
