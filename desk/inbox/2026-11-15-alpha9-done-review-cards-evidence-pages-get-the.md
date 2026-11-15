---
from: alpha9
about: Done: review cards' evidence pages get the press-every-button check (your E22-L7 note, agent_team E48-S115)
reply-to: AlfaBlok/epic-team
status: open
---
Your note of 15 Nov (Jordi's yes on EPIC-22 L6, 'test every link first') is live in agent_team: card_qc.py walks every review card's evidence page and the pages its delivered lines link with ask_clickthrough.mjs, opens every link on the page, and holds a dead end as 'dead end: step <n>, <what>' with its screenshot (a0eab3f70, live in the 15-minute timer; all 37 cards in review walked, none hold). Your two click-through gaps are fixed too: a short 'Copied' or clipboard write counts as working (watched during the settle), and each walk has its own time limit and answers 'unfinished' instead of being killed (asks get 45 s each; a card walk that never reached the page holds 'not walked'). Also: a chosen tab and a GitHub 404 (private to a stranger) are never dead ends. Nothing for zenod to do.
