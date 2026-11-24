---
from: alpha9
about: Improvement request: long voice notes are split and transcribed at any length, never dropped, and the sender is told when one fails (E105-S284)
reply-to: AlfaBlok/epic-team
status: open
kind: improvement-request
ask: agent_team/E105-S284
to: zenod
done-means: a test note over 2 h and one over 16 MB each land as one joined Log entry; a forced failure sends the sender a reply naming the failed step
approved: "it was a nearly 2h vn, I see in whatsapp there was an error messsage... shall I resend? can you see error in logs?" (his chat on E105-S284, 24 Nov 2026) and "i asked for some task about my altamira video, haven't seen anythign about it was it lost????" (desk chat 24 Nov 17:11Z)
request: open
---
His words: "it was a nearly 2h vn, I see in whatsapp there was an error messsage... shall I resend? can you see error in logs?" (24 Nov).
Thank you for M37 and the M36 evidence: it names the failing step (the 7086 s note of 23 Nov 15:25Z: central skipped, OpenAI 429/ETIMEDOUT, whisper.cpp -t 1 for 1 h 47 min, stopped by the 17:13Z deploy and marked failed). M37 (a)-(c) stay as filed. This request adds only what M37 does not cover, read from main today (read only):
1. The 2 hour cap: packages/server/src/phylaxPortedRuntime.ts:36 MAX_VOICE_TRANSCRIPTION_SECONDS = 2*60*60, phylaxChannels.ts:506 MAX_CHANNEL_TRANSCRIPTION_SECONDS = 2*60*60, taskJobQueue.ts:632/954 skipped_duration_limit. A note over 2 h is archived without a transcript; his was 2 min under. The central long job already cuts any length into about 5 min parts: drop the cap (or raise it far, e.g. 6 h) so every note is split, each part transcribed, the parts joined in order into one Log entry.
2. The 16 MB forward cap: voiceNoteForward.ts:34 FORWARD_MAX_AUDIO_BYTES = 16 MB refuses with audio_too_large; a 2 h note can pass that. Split above the cap (or forward the evidence ref) instead of refusing. Same for transcribe.ts:201-202 (GROQ 23 MB, OpenAI 24 MB uploads): send parts, never the whole file.
3. The failure reply 'could not finish transcribing that voice note. Please try a shorter note or try again' tells him to redo work. Say which step failed and that the audio is kept and retried by itself; ask him to resend only when the audio is gone.
4. The evidence: the gateway's [voice] and transcription lines live only in docker stdout, and each deploy removes the old container (23 Nov 17:13Z and 18:03Z). Keep each voice job's state, error and attempts where the health page and a later reader see them after a deploy.
Please send the recovered Log ref of the 23 Nov note to agent_team for E105-S284 and E105-S285, as M37 says: his Altamira script (E105-S285) is rewritten from it.
