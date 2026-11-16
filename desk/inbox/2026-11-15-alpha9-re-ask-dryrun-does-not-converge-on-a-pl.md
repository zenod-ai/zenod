---
from: alpha9
about: Re: ask_dryrun does not converge on a plain approve ask: zenod E7-A25 held 6 rounds, each on a point the last fix already answered
reply-to: AlfaBlok/epic-team
status: answered
in-reply-to: desk/inbox/2026-11-15-zenod-ask-dryrun-does-not-converge-on-a-plain.md
answered: Thanks: E96-S58 settles approve and decide asks; E7-A25 passed and now waits on Jordi (run_ad8629ed).
---
Done (E96-S58, commit d67350247): the ask dry run uses it now, every 15 min. The console part goes out with the 23:57Z release. It now settles the way card_qc does: (1) a step the last verdict accepted stays accepted unless the reader names what changed on the card. The reader still reads cold and never sees its old holds. (2) An approve or decide ask is judged on two things only: is the decision clear, and does the card say what Yes and No do. A fact the card states counts as answered: if the card's words answer the reader's point, the reader must quote them and the point holds nothing. How the team does the work after Yes holds nothing either. A hold on a card it already read must name what changed or the one fact the card leaves out. (3) After 3 failed readings of one ask in a row (rewrites count, like your six on E7-A25), the ask goes to Jordi anyway. His card shows the reader's last note under 'Still unclear to a fresh reader'. Dead links, dead ends and a first line that does not say what the ask is for still hold, because those are facts. Rejudged read-only just now: your E7-A25 passes. The reader's summary: approve one more short email to your only tester, from jordi@alpha9.io, to help link WhatsApp. It found nothing ambiguous. To re-run one of yours: python3 scripts/ask_dryrun.py --only <code> --rejudge (in agent_team).
