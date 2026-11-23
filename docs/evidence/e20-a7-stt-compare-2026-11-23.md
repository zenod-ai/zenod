# E20-A7 evidence: the free service against Zenod's stored recordings (2026-11-23)

Objective: Zenod: Get 5 testers: every voice note is transcribed for free, well, and never lost.

```
stored recording (Zenod archive) ─▶ central service on vps3 (turbo, small) ─▶ compared word for word with the text stored that day
                                                                               apart %, numbers, names, time per minute of audio
```

Jordi, 22 Nov 20:38Z (EpicTeam card answer): "I would run some tests because ... Zenod is keeping all these binaries of the raw audios, and we have the transcriptions."
Comparison page (no personal text, tailnet): http://vps3.taild81fbb.ts.net:9372/ · numbers per clip: [e20-a7-stt-compare-2026-11-23.json](e20-a7-stt-compare-2026-11-23.json).

## Verdict

**Good enough for Jordi's notes and the testers' notes, with turbo up to 45 s.** The two readings differ by 2.6% (notes up to 30 s) to 7.7% (30 to 90 s) of words on turbo, 5.3% to 9.0% on small. The stored text is itself not exact, so this is closeness, not truth. Where it is worse: **small on Spanish** (median 13.6% apart against 4.8% on turbo) and one noisy two-voice street conversation (about 30% on both models). Nothing else stood out.

## What was tested

- Source: 27 recordings from the team's own vault, never a tester's: 17 web recordings (webm) from the console store, 6 WhatsApp notes (ogg, read back with `get_raw_artifact`, sha256 checked) and 6 Spanish ones (5 cut to their first 30 s, 1 whole). 24.5 minutes. Up to 30 s: 11 notes; 30 to 90 s: 10; over 90 s: 6 (small only: the server sends those to the paid provider).
- Set aside (2): one recording whose audio is silent while its stored text is words, and one 30 s Spanish clip both models returned empty for (Zenod treats empty as a failure and falls back to the paid provider).
- Same request as the server sends (multipart, `x-caller: zenod`, language auto, the service's own word list). Words lowercased, punctuation dropped, spoken numbers written as digits; "apart" is word edit distance over the stored text's words (for a 30 s cut, over its first words).
- Stored text came from the paid or older providers (gpt-4o-mini-transcribe, voxtral, whisper), so a difference is not always the central service's error.

## Table (turbo and small on the same notes)

| Kind | Notes | turbo apart | small apart | turbo time | small time |
|---|---|---|---|---|---|
| Up to 30 s | 11 | 2.6% | 5.3% | 25 s median, 38 s longest | 7 s |
| 30 to 90 s | 10 | 7.7% | 9.0% | 43 s, 52 s longest | 11 s |
| Over 90 s | 6 | not run | 4.6% | too slow for 60 s | 17 s |
| English | 16 | 4.4% | 5.7% | | |
| Spanish | 5 | 16.7% (median 4.8%) | 19.7% (median 13.6%) | | |
| WhatsApp ogg | 6 (3 on turbo) | 3.9% | 4.9% | | |
| Quiet (mean under -24 dB) | 6 | 4.5% | 3.7% | | |

Turbo closer on 12 of 21 notes, small on 4, equal on 5. Disagreement between turbo and small themselves: median 3.7%.
Speed at machine load 17 to 22: small about 0.2 s of work per second of audio, turbo about 0.7 (plus about 25 s fixed cost on short notes).

## Numbers and names

- Numbers: 3 of 62 checks differ (turbo 1 of 16, small 2 of 46); one is the stored text writing a digit where the speaker said a word.
- Names: the stored text writes the product name wrongly in five ways (masked: "Xxxxx", "Xxxx", "Xxxxxx"); the central service writes it right, because the service carries the team's word list. No person's name was lost.
- Masked example of the one real worse case: a noisy two-voice Spanish clip, small wrote a made-up word where turbo wrote the right Spanish phrase ("Xxxxxxx ... xxxxxxxxxxx" against "Xxxxx ... xxxxxxxxxx").

## Change from the result

PR [#1752](https://github.com/zenod-ai/zenod/pull/1752): turbo up to 45 s (was 30 s), small up to 90 s (unchanged), longer to the paid provider. Notes of 45 s need about 33 s of work on turbo, inside the 60 s limit; the 30 to 90 s measurements ran 43 s median and 52 s longest.

## Finding: the service was down, and still dies under memory pressure

- `agent-team-transcribe.service` was stopped by SIGTERM at 00:02Z and not restarted for 3 hours (`Restart=on-failure` treats SIGTERM as a clean exit). Zenod production (promoted 00:48Z) logged `[central-stt] unreachable cause=ECONNREFUSED` at its boot, so production ran on the paid fallback from 00:02Z.
- Cause: `earlyoom -m 10 -s 100,100 --sort-by-rss` ends the largest process when free memory is under 10%; turbo takes 1.4 GB. 13 restarts in 40 minutes while turbo was loaded (small alone survived).
- Done: user drop-in `agent-team-transcribe.service.d/restart.conf` (`Restart=always`, `RestartSec=15`), started again at 03:11Z; desk note to agent_team for the unit file and the lasting fix.
- Fallback worked as designed: no note can be lost, the cost is the paid call.

## Production use: real notes

- Real WhatsApp voice notes since Phylax went live on cc23c62 (22 Nov 23:57Z): **0**. The newest WhatsApp voice note in the vault is 22 Nov 18:00Z. Central: 0, paid fallback: 0, zero `central_fallback` alarm lines in zenod-mt or Phylax logs (health row 21: none).
- Phylax at its boot: `[central-stt] reachable` 23:57:38Z. zenod-mt at its boot (cc23c626, 00:47Z): unreachable (service down, above). It moves to the next sha, and re-probes at its boot, at the promote after 09:00Z; the production test note is held for that (see the row).
