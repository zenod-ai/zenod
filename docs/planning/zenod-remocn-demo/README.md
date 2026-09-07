# Zenod Remocn motion proof

A 22.8-second, silent product-demo prototype for the Zenod landing page. It tests the Remocn/Remotion visual language from Kapish Dima's launch example: reconstructed UI, deterministic interaction choreography, restrained motion, and code-owned components.

## Story

1. Your context should outlive every agent.
2. A 35-minute voice note is captured in chat.
3. The Zenod librarian organizes decisions, projects, questions, and source evidence.
4. An agent retrieves the memory and creates a linked launch backlog.
5. Zenod closes on “Own your agent's memory.”

## Commands

```bash
npm install
npm run dev
npm run lint
npx remotion render ZenodMemoryLoop renders/zenod-memory-loop-v1.mp4
npx remotion render ZenodWhatsAppReceipt renders/zenod-whatsapp-receipt-v1.mp4
```

The editable composition is `src/ZenodDemo.tsx`. Remocn components are copied into `src/components/remocn/`, so the project owns the source and can alter their timing or appearance directly.

`src/WhatsAppReceipt.tsx` is the shorter nine-second proof: a WhatsApp voice note, Zenod's save receipt, and an explicit stored-memory state.

## House journey — Remocn v1 (2026-09-07)

`src/HouseMemory.tsx` is a new 21-second direction: ingestion (0–5s), digestion (5–9.5s), retrieval in Codex (9.5–17s), then “Your agents change. Your context stays.”

Uses the locally owned Remocn MessageBubble, TypingIndicator and SoftBlurIn components with frame-driven custom UI choreography. Illustrative interfaces and sample copy, not live product footage or financial analysis. Silent, 1280×720, 30 fps. Prior compositions remain available.

Preview: `review-house.html`. Render: `renders/zenod-house-remocn-v1.mp4`.

```bash
npx remotion render ZenodHouseMemory renders/zenod-house-remocn-v1.mp4 --concurrency=2
```

Validation: TypeScript, ESLint on changed sources, rendered-frame inspection of capture/wiki/recall/finish, and ffprobe metadata.

## Headline revision — v2

27-second cut adds two full-screen 94px headline beats, each three seconds: “Turn a thought into lasting memory.” before digestion and “Pick up the thought. With any agent.” before retrieval. Review page now points to `renders/zenod-house-remocn-v2.mp4`. Prior render remains available.

## Full script cut — v3

`src/ContextStory.tsx` / `ZenodContextStory`: 90 seconds, 1280×720 at 30 fps. Script and exact scene durations are in `src/story-v3.json`. Review via `review-story.html`; video at `renders/zenod-context-story-v3.mp4`.

Eight beats: separate context islands (0s), repeated explaining (9s), user-controlled shared memory with read/write connections (17s), WhatsApp capture (27s), linked wiki digestion (42s), Codex retrieval (54s), later write-back (70s), finish (82s). Enlarged simplified interfaces, headline holds, reading pauses. Remocn supplies message bubbles, typing dots and the finish typography.

Audio is temporary local macOS speech synthesis: Samantha narration, Daniel illustrative voice note, 165 words/minute requested. Text, source AIFF and encoded M4A files are retained in `public/story-v3`. Each track was measured to fit its scene with no speech cutoff. No music. Interfaces are illustrations; no real private context, live execution or financial findings are represented.

```bash
npx remotion render ZenodContextStory renders/zenod-context-story-v3.mp4 --concurrency=2
```


## Final library revision — v5

126-second cut at `renders/zenod-context-story-v5.mp4`, preview `review-story.html`, script `SCRIPT-CONTEXT-STORY.md`. Adds curated context → better understanding → useful learning (82s), then permanent library / replaceable librarian / preserved originals (98s), closing at 118s. The relationship is illustrated without a quantitative quality guarantee. Original MP4 revisions are retained.


## Personal Alexandria cut — current

`renders/zenod-personal-alexandria.mp4`: 133 seconds. The context is yours / The context matters / Keep the raw / Hire a smart librarian / Test Zenod free. Ends with the user-requested personal Alexandria CTA and Obsidian-compatible, Karpathy-inspired wiki positioning. Preview: `review-story.html`. All narration tracks fit their scene durations; changed-source TypeScript and ESLint checks pass. No publishing or signup configuration changed.

### Approved baseline and task-state follow-up

Commit `836941b` preserves the approved film before the task-state addition. The current write-back scene adds two illustrative tasks to state memory: check local house-price data and compare mortgage scenarios. Timing and narration remain unchanged. Validation: changed-source TypeScript/ESLint and rendered write-back frame inspection.

The follow-up also changes retrieval to “Please retrieve the tasks I laid out in yesterday’s keynote.” Result, original-recording reference, narration and script match that request. This deliberately broadens capture examples beyond the opening WhatsApp house voice note.
