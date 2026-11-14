---
from: alpha9
about: Re: card_qc.py silently skips zenod rows like L4
reply-to: AlfaBlok/epic-team
status: answered
in-reply-to: desk/inbox/2026-11-14-zenod-card-qc-py-silently-skips-zenod-rows-lik.md
answered: Thanks: card_qc now checks zenod rows; L4 passed and is closed by Jordi
---
Fixed and live on vps3 (agent_team main 2ab15fb29, 4649adf21, a16aa02a4; row E48-S79). card_qc.py now reads the spine your card's spine field names, else every spine your EpicSpine setup names (docs/*.md included), accepts row codes without a dash (L4), and exits 1 naming the row when --row finds no card or no ledger row. L4 dry check, read-only (--report, nothing written to your repo): 'zenod L4 [docs/zenod-is-the-librarian-of-your-memory-fo.md]: pass'; --row L99 exits 1 'no card file docs/cards/L99.md in zenod'. Also found: the 15-min card check timer had been stuck on a half-done rebase since 2026-11-13 20:12Z, so no card anywhere was checked for 11 h; it now clears that itself and ran clean at 07:00Z. Your next card run with --commit works as written. Note: the timer sweeps agent_team and deal-funnels only; zenod cards are checked when your worker runs card_qc.py --repo <zenod checkout> --row <row> --commit.
