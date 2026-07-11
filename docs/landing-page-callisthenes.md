# Callisthenes — Landing Page Structure

**URL:** `calli.zenod.dev`
**One-line value prop:** Give every agent a voice. Keep the keys to yourself.
**Competitive edge to land:** everyone else's answer to "let my agent post" is pasting API keys into prompts or agent configs. Callisthenes is an outbound identity *broker*: keys live in one guarded place, agents get sends — never secrets — and nothing goes out without your word. The permalink receipt is the proof no one else offers.

---

## 1. Hero

- **Headline:** "Your agents can post. Your keys never leave."
- **Subhead:** "One guarded endpoint for X, Reddit, and email. Drafts never send without your word. Every send returns the live permalink."
- **Primary CTA:** `Get started` → GitHub sign-in
- **Secondary CTA:** `Self-host free`
- **Hero visual:** a draft-approval moment — screenshot of a held draft ("waiting for your word") next to the posted tweet with its permalink receipt. The before/after IS the product.
- Trust strip: `drafts never send · receipts always · keys in custody`

## 2. The problem

- "Agents are eager. Credentials are dangerous." Two-line horror story: an agent with your X keys is one bad prompt away from posting anything, any time, at any rate.

## 3. How it works (3 steps + screenshots)

1. **Connect your accounts once** — screenshot: the OAuth connect page (X + Reddit).
2. **Point any agent at your MCP URL** — screenshot: `post_tweet` tool call from Claude.
3. **Approve, and get the receipt** — screenshot: draft queue → approval → permalink receipt returned to the agent.

## 4. Key claims (4 cards)

- **Drafts never send** — hard rule, server-enforced. Your word or your standing order.
- **Permalink receipts** — every send returns the live URL. Evidence, not claims.
- **One custody point** — keys live here, encrypted; agents never see them.
- **Throttle built in** — pacing and caps; no 3 a.m. posting storms.

## 5. Show it working

- Looped recording: agent drafts 3 tweets → they queue → you approve one → it posts → permalink lands back in the agent chat. The "standing order" variant as a second tab for power users (the daily-herald demo from the launch decks).

## 6. Who it's for (one row, three personas)

- Builders running posting agents · people automating a personal brand ("10 posts a day, always on message") · teams that need an audit trail for outbound.

## 7. Pricing

- **Hosted — €5/month** (single clear number; it converts better than "low fee").
- **Self-hosted — free**, same image, one tenant.
- Note X/Reddit first, email next — roadmap honesty in one line.

## 8. FAQ

Can an agent post without approval? (only via a standing order you wrote) / What if I revoke? / Where are my keys stored? (encrypted custody, your tenant only) / Which platforms? / Rate limits?

## 9. Footer

Docs · GitHub · Pricing · the Council strip (Zenod, Ring, Epaminon, Phylax).

---

**Shot-list:** connect page · draft queue · approval click · permalink receipt · throttle/usage panel · agent-side tool call.
**Tone:** guard-like, dry confidence. The mantra "X first. Reddit next. Receipts always. Drafts never send." can literally be a section divider.
