# Herald — the practice unit (the guy)

Herald is a **social-practice agent**: a smart LLM that runs your public-presence
practice — negotiates a briefing with you, proposes posts every morning (each one
citing where in memory it came from), and — once you tick ✓ — has them posted. Herald
holds no memory of its own and no outbound keys: it **reads your briefing and standing
directives from [Zenod](../zenod/) every turn**, and it **posts only through
[Callisthenes](../callisthenes/) (the mouth)**. Herald is the guy in the middle; the
two seams on either side are swappable by config.

**One guy, two peers, zero world keys.** Herald talks MCP to exactly two units —
Zenod (memory) and Callisthenes (send) — with per-unit tokens injected at provision.
It never carries a GitHub repo token, an X token, a Reddit key, or an SMTP credential.
There is no auto-send path: **every post carries your ✓** (HD-2, supervised at launch).

> **Herald ships inside a one-room ring** (Epic 2.6 THE CONVERGED DESIGN). WhatsApp is
> never wired into Herald — the ring nucleus (Phylax gateway + tiny core, lane H-1)
> pairs the phone and relays your words to Herald verbatim with attribution. Herald's
> own front door is a plain MCP endpoint (below); the ring is just one client of it,
> and BYO-ring customers point their own ring at the same endpoint.

---

## What Herald is (and is not)

| Herald IS | Herald is NOT |
|---|---|
| the guy: LLM brain + practices scheduler in-process | a router / classifier (that's the 2.7 nucleus) |
| an MCP **server** (its front door — the ring/BYO-ring calls it) | a keyring UI or attention-rules engine (2.7) |
| an MCP **client** to Zenod + Callisthenes only | a memory owner (memory is Zenod's; Herald borrows it) |
| supervised: drafts, cites, waits for ✓ | an auto-poster (no unattended send at launch, HD-2) |

The scheduler that fires the morning proposals runs **in-process** — the proposal
queue lives in Herald's own memory pages (stored via Zenod). There is **no Epaminon and
no Archus** in this loop; Herald is self-driving.

---

## The endpoint (BYO-ring: point your own ring here)

Herald serves plain [MCP](https://modelcontextprotocol.io) over streamable HTTP at
**`http://localhost:8090/mcp`** (public deploys front it at `https://<host>/mcp`). A
ring, a Console, or any conformant MCP client reaches Herald only through this surface —
see [SEAM-SURFACE.md](./SEAM-SURFACE.md) for the tool list and receipt shapes.

Auth is a per-unit bearer token in `Authorization: Bearer <token>`, issued by the
keyring at provision. A self-host instance with no keyring is **not** tokenless: pin the
bearer with `HERALD_API_TOKEN`, or read the auto-generated one printed once to the boot
logs (mirrors Zenod's ZD-9 rule).

Health: `curl -s http://localhost:8090/api/health`.

---

## The two seams Herald depends on (modularity is config)

Herald's memory and mouth are **URLs + tokens**, nothing more. Swap either for any
conformant unit and Herald doesn't notice. Hosted buyers never see these knobs; a
self-hoster sets them in [docker-compose.herald.yml](./docker-compose.herald.yml).

| Seam | Env | Points at | Herald uses it to… |
|---|---|---|---|
| **memory** | `ZENOD_MCP_URL` + `ZENOD_MCP_TOKEN` | a Zenod-conformant memory unit | read the briefing + standing directives (every turn), cite proposal sources, file reactions/lessons back as memory commits |
| **mouth** | `CALLISTHENES_MCP_URL` + `CALLISTHENES_MCP_TOKEN` | a Callisthenes-conformant send unit | publish an approved post and get a permalink receipt |

Herald calls Zenod's read tools (`search_memory`, `get_memory`, `ask_brain`) and write
tool (`store_memory`) — see [../zenod/SEAM-SURFACE.md](../zenod/SEAM-SURFACE.md). Herald
publishes only through Callisthenes' `approve_send` (which posts exactly once and returns
a live URL) — see `packages/server/src/agent.ts` `OUTBOUND_AGENT` (displayName
"Callistheness"). **Herald never holds the world keys those units hold.**

---

## The two flows Herald runs

### (a) Briefing negotiation → memory page one
1. You hand Herald raw context (decks, a voice note) via the ring.
2. Herald **drafts** a briefing (goals, voice, cadence, audience) and asks clarifying
   **questions** — it does not guess.
3. You answer; Herald **iterates** the draft.
4. You say **✓**. Herald commits the approved briefing to Zenod (`store_memory`) — this
   is **memory page one**, the standing directive it re-reads every turn.

### (b) Morning-N proposals ritual → supervised posting
1. The in-process scheduler wakes; Herald re-reads the briefing + directives from Zenod
   (the **turn preamble** — a seam read every turn, never cached blindly).
2. Herald composes **N proposals**. **Each proposal cites its memory source** (the Zenod
   path / GitHub URL it drew on) so you can trace every suggestion.
3. You react — e.g. **"✓ 1,3 + give me five more"**. Approvals and rejections are
   **filed back to Zenod as memory commits** (reactions become durable lessons); Herald
   returns five more in the same round-trip.
4. Approved proposals go to Callisthenes for posting **only after your ✓** (HD-2). The
   permalink receipt comes back into the chat and is filed to memory. Nothing sends
   without a ✓ — there is no auto-send path.

---

## What you can rely on (the contract)
- **The endpoint is standard MCP** — `tools/list` + `tools/call`, nothing custom on the
  wire. Conformant to [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md).
- **Every proposal is traceable.** A proposal without a cited memory source is a bug;
  reactions land as real memory commits (Zenod receipts: `commitSha` + GitHub URL).
- **No key Herald shouldn't have.** Herald holds two peer bearer tokens and nothing
  else — no repo token (Zenod's), no outbound/world keys (Callisthenes'). Any send
  attempt down another path has no credential and fails loudly (law 6b).
- **Supervised at launch.** Every post carries your ✓ until the unattended soak passes
  (HD-2). Auto-send graduates later per lane config — not in Move 0.

## Files in this unit
| File | What it is |
|---|---|
| `README.md` | this quickstart + the two flows (an acceptance item) |
| `SEAM-SURFACE.md` | Herald's MCP tool surface + the two peer seams it consumes |
| `docker-compose.herald.yml` | deploy stub (root-image reuse, `AGENT=herald`) |

## The code step this blueprint anticipates (FUTURE — not done here)
This folder is the **seam of record** for Herald-as-a-unit; no running code is added by
this lane. When the code step fires, add a `HERALD_AGENT: AgentDefinition` to
`packages/server/src/agent.ts` alongside `ZENOD_AGENT` / `OUTBOUND_AGENT` / etc.:

- `name: "herald"`, `displayName: "Herald"`, `tagline: "Social-practice agent"`.
- `vaultless: true` — Herald owns no repo; its memory is Zenod over the seam.
- a **new capability flag** (e.g. `practice?: boolean`) that wires the engine with: the
  two peer MCP clients (memory + mouth), the in-process practices scheduler, and the
  turn preamble that reads the briefing/directives from the memory seam each turn.
- a `persona` in the spirit of the others: *"You are Herald, the guardian of the user's
  public-presence practice. You read the briefing and standing directives from memory
  every turn; you propose, you cite every proposal's memory source, and you NEVER post
  without the user's explicit ✓ — you publish only through the mouth unit and hold no
  outbound keys."* (Mirror Callisthenes' hard no-send-without-confirmation rule.)

> **Status honesty:** the physical Herald container does not exist yet. This is the
> blueprint that lane H-2 hands to the code step; do NOT read it as shipped.
