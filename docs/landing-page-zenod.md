# Zenod — Landing Page Structure

**URL:** `zenod.dev` (root) · app at `cloud.zenod.dev`
**One-line value prop:** Your memory as a managed wiki in your own GitHub — the librarian your AI agents report to.
**Competitive edge to land:** every other "AI memory" is a black-box database inside someone else's SaaS. Zenod's memory is plain markdown, in *your* repo, with git commits as provenance. If you cancel, you keep everything.

---

## 1. Hero (above the fold)

- **Headline:** "It's your memory. In your GitHub."
- **Subhead:** "A librarian your AI agents report to. Plain markdown, Obsidian-compatible, every memory a commit — in a repo you own."
- **Primary CTA:** `Get started` → GitHub sign-in
- **Secondary CTA:** `Self-host free` → README one-liner
- **Hero visual (show the product immediately):** split-screen screenshot — left: a Claude chat calling `store_memory`; right: the resulting commit appearing in a real `github.com/you/brain` repo (the commit-SHA repo-window mock from launch deck v5 works as an interim). This is the whole product in one image: agent writes → your repo receives.
- Trust strip under CTAs: `AGPL-3.0 · plain markdown · your git · your keys`

## 2. The problem (one short block)

- "Your context lives in N isolated pieces — ChatGPT threads, Notion, Apple Notes. None of it compounds."
- Claim: **"Your context is mineable. Own the mine."**

## 3. How it works (3 steps, each with a screenshot)

1. **Sign in with GitHub, connect a vault repo** — screenshot: dashboard vault-connect flow.
2. **Copy one MCP URL into Claude or Codex** — screenshot: dashboard with the MCP URL front and center + copy button and snippets (this screen exists — it's journey step 5).
3. **Every memory becomes a commit** — screenshot: git history of the vault, or the vault open in Obsidian.

## 4. Key claims (3–4 cards, each provable)

- **One writer, no drift** — only Zenod writes memory; writes are gatekept, reads stay open.
- **Git provenance** — every mutation returns a receipt and a commit. Evidence, not vibes.
- **Agent-mode answers** — `ask_brain` reasons over the vault, doesn't just retrieve.
- **Exit any time** — it's markdown in your repo. Cancel and lose nothing.

## 5. Show it working (the satisfying demo)

- 20–30s screen recording (autoplay, muted, looped): voice note → transcript filed → commit lands → `ask_brain` answers from it. If video is too heavy for v1, a 4-frame annotated screenshot strip of the same journey.

## 6. Works with the tools you already use

- Logo/badge row: Claude · Codex · Obsidian · GitHub · any MCP client.
- One code block: the exact `mcp.json` / CLI snippet from the dashboard.

## 7. Pricing (mirror the live pricing page, keep to 3 columns)

- **Self-hosted** — free forever, AGPL-3.0, `docker run` one-liner.
- **Monthly** / **Yearly** — hosted, same engine, same owned repo. `alpha — first 100 free` banner.
- CTA on each column; anonymous buy click → sign-in → straight into checkout (already the flow).

## 8. FAQ (5 questions max)

Who can read my vault? / What happens if I cancel? / Self-host vs hosted difference? (identical image, tenant count of one) / Which agents work with it? / Is my data used for training? (no — your repo, your keys)

## 9. Footer

Docs · GitHub (AGPL) · Pricing · Sign in · the other units (Callisthenes, Ring, Epaminon, Phylax) as a quiet "The Council" strip — cross-sell without clutter.

---

**Screenshot shot-list (capture once on the live deployment):** dashboard MCP-URL panel · vault-connect · a real vault repo commit history · Claude tool call · Obsidian view of the vault · pricing page.
**Tone:** the launch-deck voice — calm, evidential, slightly literary. No "revolutionize", no exclamation marks. Every claim next to a screenshot that proves it.
