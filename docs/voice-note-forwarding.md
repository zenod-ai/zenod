# Forward voice notes to Zenod

A voice note someone records in your app can land in their Zenod memory like one sent on WhatsApp. Zenod keeps the raw audio. If you send your transcript it is used as is and never transcribed again; if you don't, Zenod transcribes the audio once. Zenod then writes a Log entry tagged with your app's name and files it into the person's topic pages. This page is the whole contract: any app can follow it. EpicTeam Chat is the first.

Built in EPIC-21 V1 ([spine](one-home-for-all-your-voice-notes-other.md)).

## 1. Get a token for one person (once)

Use Zenod's "Sign in with Zenod" OAuth flow (authorization code with PKCE S256) and ask for the scope `voice_notes.write`.

1. Register your app once: `POST https://cloud.zenod.dev/oauth/register` (RFC 7591) with your `client_name` and `redirect_uris` (HTTPS, or `http://localhost` for development). Keep the `client_id`.
2. Send the person to
   `https://cloud.zenod.dev/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256&scope=voice_notes.write`
   Zenod signs them in and shows "<your app> wants to send its voice notes to your Zenod", with what it gets (adding voice notes, tagged with its name) and what it does not get (reading anything, changing or deleting anything).
3. Exchange the code: `POST https://cloud.zenod.dev/oauth/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id`. The answer holds `access_token` (`zvn_…`), `scope` and `grant_id`.

Keep the token server-side, like a password. It is valid until revoked and works only on the door below; it can never call Zenod's main `/mcp` or read the memory. The person sees your app in Zenod's Subscribers list under forwarding apps and can remove it any time; the token then stops at once. You can revoke it yourself with `POST /oauth/revoke` (`token=zvn_…`).

To also receive the person's voice notes, ask for `voice_notes.read voice_notes.subscribe voice_notes.write` in one go. Notes your app forwarded are never announced back to your own subscription, so there is no echo loop.

## 2. Forward a note

The door is an MCP server (Streamable HTTP, stateless, JSON responses):

```
POST https://cloud.zenod.dev/api/subscribers/v1/mcp
Authorization: Bearer zvn_…
Content-Type: application/json
Accept: application/json, text/event-stream
```

Any MCP client works (point it at the URL with the bearer header). It has two tools.

### `ingest_voice_note`

| Field | Required | Meaning |
|---|---|---|
| `sourceApp` | yes | Your app's name as the person knows it, e.g. `EpicTeam Chat` (≤60 characters). Shown in the Log entry, the receipt and Zenod's recent saves. |
| `idempotencyKey` | yes | Your stable id for the note, e.g. its id in your app (≤200 characters). Forwarding again with the same key returns the first job and files nothing new. Keys are scoped to your app: another app using the same key makes its own note. |
| `audioBase64` + `mimeType` | one of the two | The raw audio, base64, and its format. |
| `audioUrl` | one of the two | A public HTTPS URL Zenod can fetch without signing in, such as a short-lived signed link. No redirects; private and local addresses are refused. `mimeType` is optional here (the response's content type is used). |
| `transcript` | no | Your transcript. Used exactly as sent; Zenod makes no transcription call. Leave it out and Zenod transcribes the audio once. |
| `transcriptModel` | no | The model that made your transcript, e.g. `gpt-4o-mini-transcribe`. Recorded with the note as "Transcribed by gpt-4o-mini-transcribe (transcribed by EpicTeam Chat)". |
| `recordedAt` | no | When it was recorded, ISO-8601 with a zone. Defaults to now. This is the time the note has in the memory. |
| `durationSeconds` | no | Its length, if you know it. |

Formats: webm, ogg or opus, mp4 or m4a, aac, mp3, wav. Largest audio: 16 MB (about an hour of speech at 32 kbit/s).

The answer comes at once: `{ jobId, status: "queued", duplicate: false, sourceApp, transcript: "supplied" | "zenod", … }`. On a repeat forward, `duplicate` is `true` and `jobId` is the first one.

### `get_voice_note_ingest`

`{ jobId }` returns `status` (`queued`, `running`, `done`, `error`), `filing` (`saving`, `saved` or `failed`, as Zenod's app shows it), `transcript` (`supplied` or `zenod`), `transcribedBy`, `evidenceRef` (the Log entry, e.g. `Log/2026-11-08.md#^e-…`) and `pagesTouched`. Only your app's own jobs are visible.

### Errors

Tool errors come back as an MCP result with `isError: true` and `structuredContent: { code, message }`:

| `code` | What to do |
|---|---|
| `invalid_input` | Send exactly one of `audioBase64` or `audioUrl`; `mimeType` with `audioBase64`. |
| `unsupported_audio`, `invalid_audio`, `audio_too_large` | Fix the audio; retrying the same request will fail again. |
| `audio_url_not_allowed`, `audio_fetch_failed` | Use a public HTTPS link that answers without sign-in, or send the bytes. |
| `ai_allowance_exhausted` | The person's Zenod has used its AI allowance; nothing was kept. Retry later with the same key. |
| `capture_unavailable` | Retry with the same key. |

HTTP-level answers: 401 `invalid_token` (no token, or the person removed your app: stop forwarding), 403 `insufficient_scope` (the token lacks `voice_notes.write`), 413 (body too large), 429 `rate_limited` (60 calls a minute per token; retry after a minute), 503 `subscribers_disabled`.

## What lands in the memory

One Log entry per note, the same shape as a WhatsApp voice note, with these lines on top of the words:

```
Voice note "epicteam-chat-voice-note-2026-11-08T18-53-00Z.ogg" ingested through Zenod media seam.
Raw artifact: …            (the archived audio, with its sha256)
Source: EpicTeam Chat voice note
Source app: EpicTeam Chat
Source timestamp: 2026-11-08T18:53:00Z
Transcribed by gpt-4o-mini-transcribe (transcribed by EpicTeam Chat).
```

The entry has content type `voice_note`, so search, `ask_brain`, the recent voice notes list and the voice-note subscribers all find it, and filing into topic pages follows in the background as for any capture.

## Example (curl, no SDK)

```sh
curl -sS https://cloud.zenod.dev/api/subscribers/v1/mcp \
  -H "Authorization: Bearer $ZENOD_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ingest_voice_note","arguments":{
        "sourceApp":"EpicTeam Chat","idempotencyKey":"vn_d4b0d617",
        "audioUrl":"https://example-bucket.s3.amazonaws.com/vn_d4b0d617.webm?X-Amz-Signature=…",
        "transcript":"…","transcriptModel":"gpt-4o-mini-transcribe","recordedAt":"2026-11-08T18:53:00Z","durationSeconds":571}}}'
```
