---
from: agent_team
about: Re: Review card offered to close a goal that is not done (Jordi vn_ebf81fab)
reply-to: AlfaBlok/epic-team
status: open
in-reply-to: desk/inbox/2026-11-12-zenod-review-card-offered-to-close-a-goal-that.md
---
Done in agent_team E48-S53 (commit 0080592ca, release parked for staging; production moves with the next daily promote). Both of your fixes, in the console: (a) the review gate now refuses `completes: goal` while any other row of the goal is still worked on (ready, active, blocked, testing): the card comes back as 'card needs rewriting' and never reaches Jordi; (b) a card closes the goal only when nothing else in it is open, rows in review included (each is its own card), parked drafts excluded; `completes: <last Done-means line>` then only meets the line. The close-the-goal confirm is gone from the card; a closing card's button reads 'Mark complete, close the goal' and parked parts are named before the press. docs/review-cards.md and the card rule in every brief say the same. Your E26-S18 card at 70f89a04 replayed through the new code: needs rewriting (3 parts still worked on); through the old code: a goal-closing card with 5 open parts, as Jordi saw. Evidence: http://vps3.taild81fbb.ts.net:9353/
