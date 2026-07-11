# Phylax — Landing Page Structure

**URL:** own page (private-network unit; sell via zenod.dev family / Ring page, standalone page when the "wire me to any agent" panel ships)
**One-line value prop:** The channels MCP that hands your agent text — and never acks silently.
**Competitive edge to land:** WhatsApp/Telegram integrations are flaky, ToS-exposed, and usually welded into some framework. Phylax isolates all of that in one unit: your agent gets clean, sender-tagged text (voice notes already transcribed at the edge), and every outbound send returns a delivery receipt or fails loudly. Wire it to ANY agent — that's the standalone sell.

---

## 1. Hero

- **Headline:** "Give your agent a phone number."
- **Subhead:** "WhatsApp and Telegram in, clean text out — voice notes transcribed at the edge, every message sender-tagged, every send receipted. Wire it to any agent you run."
- **Primary CTA:** `Get started`
- **Secondary CTA:** `Wire it to my agent` → the downstream-config docs
- **Hero visual:** phone frame with a WhatsApp voice note on the left; on the right the exact MCP payload the agent receives: `{ sender, transcript, artifact_ref, usage }`. Message goes in, text comes out — the whole product in one image.
- Trust strip: `never a silent ack · zero routing intelligence · users are rows`

## 2. The problem

- "Every channel integration is one library update away from breaking — and it usually breaks inside your agent." Phylax's answer: breakage is contained in the channels unit; your agent never feels it.

## 3. How it works (3 steps + screenshots)

1. **Get your number / connect your Telegram bot** — screenshot: number reveal + bot setup screen.
2. **Point inbound at one downstream** — screenshot: the "wire me to any agent" panel (one URL + token field — its simplicity is the screenshot).
3. **Whitelist senders, done** — screenshot: pairing/whitelist rows UI. New users are rows, zero restarts.

## 4. Key claims (4 cards)

- **Transcription at the edge** — voice becomes text before it reaches your agent; cost attributed on the payload; nothing transcribed twice.
- **Never a silent ack** — every send returns a delivery receipt or fails loudly.
- **Zero routing intelligence** — inbound goes to exactly one downstream you chose. Phylax transports; your agent decides.
- **Fails open, not stuck** — if transcription fails, the message still forwards immediately, flagged. Conversations never queue behind a model.

## 5. Show it working

- Looped recording: send a voice note to the number → agent (any agent — show a plain Claude session) receives transcript and replies → reply arrives back in WhatsApp with the receipt. Bonus beat: `notify` called from a cron/agent → phone buzzes.

## 6. Two faces (the architecture claim, made simple)

- Split panel: **Server face** — any tokened agent can `send_message` / `notify` / `channel_status`. **Notification duty for anything you run.** / **Client face** — inbound forwarded as standard MCP tool calls to your one downstream (the Ring by default).

## 7. Pricing

- **With Ring** — included in the suite pairing flow.
- **Standalone** — per phone number operated (honest model: the number is the unit).
- **Self-hosted — free**, your own number, your own box.

## 8. FAQ

Can I use my existing number? / What happens when WhatsApp breaks? (contained; queue drains on recovery) / Who can message my agent? (whitelist rows only) / Does Phylax read my messages? (transports + transcribes; routing and memory live in your units) / Telegram and what else next?

## 9. Footer

Docs · GitHub · Pricing · the Council strip.

---

**Shot-list:** number reveal · Telegram bot setup · wire-to-any-agent panel · whitelist/pairing rows · phone + agent side-by-side of one round trip · a delivery receipt.
**Tone:** guard at the gate — terse, dependable. "Never a silent ack" is the tagline that sticks; repeat it.
