# Zenod — SEAM-SURFACE (the MCP tools + receipt shapes)

Zenod's public surface, conformant to [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md).
One MCP server over streamable HTTP at `https://<host>/mcp` (locally
`http://localhost:8080/mcp`). Every caller reaches Zenod only through these tools —
no unit imports Zenod internals. Grounded in `packages/server/src/mcp.ts`.

Auth: per-unit bearer token in `Authorization: Bearer <token>`, issued by the keyring
(SEAM-SPEC §4). A self-host instance with no keyring is NOT tokenless — it auto-mints an
`api_token` on first boot; read it from `GET /api/token` and send it as the bearer.

---

## Memory tools

### `store_memory` — LONG (mutating)
Store a memory through the librarian pipeline: immutable evidence in the Log + filed
meaning on the right page(s) with citations, validated, committed to GitHub.

- **Input:** `{ content: string, hints?: string[], verbatim?: boolean }`
- **Class:** LONG (classify + compose LLM calls + git commit). Returns immediately
  with `{ jobId }` (status `queued`); does NOT hold the wire.
- **Receipt (poll `get_task_result`):** on `done`, `result` is a `StoreResult`:
  ```jsonc
  {
    "evidenceRef": "Log/2026-07-05.md#^e-7f3a2c",   // citation anchor of the evidence
    "pagesTouched": ["Areas/Insurance.md"],          // meaning pages created/updated
    "commitSha": "a1b2c3d…",                          // <- the mutating receipt (SHA)
    "githubUrls": ["https://github.com/<repo>/blob/…"],// <- and the URL handle
    "question": "…"                                   // present ONLY if confidence was
                                                       // low: filed to Inbox as a stub,
                                                       // relay this to the user
  }
  ```
  Conformance: a mutating tool MUST carry ≥1 handle (SHA/URL) — `commitSha` +
  `githubUrls` satisfy SEAM-SPEC items 3/4. Never a bare ack.

### `search_memory` — FAST (read)
Deterministic ranked search over the vault (no LLM). Call first to locate memories.

- **Input:** `{ query: string }`
- **Receipt:** `structuredContent: { hits: Hit[] }`, `Hit = { path, snippet, score, githubUrl }`.
  Empty is **explicit**: text `"No memories match '<query>'."` and `hits: []` — never a
  bare "ok" (SEAM-SPEC item 5).

### `get_memory` — FAST (read)
Read one note by vault-relative path (paths come from `search_memory`).

- **Input:** `{ path: string }`  (e.g. `"Areas/Insurance.md"`)
- **Receipt:** `{ path, frontmatter, body, githubUrl }`.
- **Loud error:** an unknown path errors (`NoteNotFoundError` → `not_found`), not a
  success-shaped empty (SEAM-SPEC items 5/15).

### `ask_brain` — LONG (read, synthesis)
Free-form question; runs a read-only research loop over the vault and returns a
synthesized answer with cited sources (vault paths + GitHub URLs). Use for fuzzy /
cross-note questions where `search_memory` alone is not enough.

- **Input:** `{ question: string }` (see `ASK_BRAIN_SHAPE`)
- **Class:** LONG (LLM loop) → `{ jobId }`, polled via `get_task_result`; result carries
  the answer + citations.

## Ingest / digest (the intake pipeline)

Zenod ingests raw sources (documents, transcribed audio, Drive files) and digests them
into evidence+meaning through the SAME store pipeline. Today this runs inside Zenod
behind an ingest queue (`packages/server/src/ingestQueue.ts`): a job moves
download → transcribe → **file (store)** → archive, each step updating its own row so a
caller can watch it and it survives restart. Receipts are the same `StoreResult` shape
(evidenceRef / pagesTouched / commitSha / githubUrls). A dedicated public `ingest`/
`digest` MCP tool is the intended surface; the mechanism exists and is receipt-shaped —
exposing it as a first-class seam tool is a follow-up (see EXTRACTION-MAP.md).

## Poll tool

### `get_task_result` — FAST (read)
Poll a LONG job (`store_memory` / `ask_brain`) by `jobId`.

- **Input:** `{ jobId: string }`
- **Receipt:** `{ status: "queued" | "running" | "done" | "error" | "interrupted", result?, message? }`.
  On `done`, `result` is the terminal evidence handle for that job (SEAM-SPEC items 6–8).

## Errors (loud, structured)

All failures surface as MCP errors carrying `{ code, message }` with stable codes:
`unauthorized` (bad/missing bearer), `not_found` (unknown note/job), `invalid_input`,
`unavailable` (e.g. repo unreachable). No success-shaped failures (SEAM-SPEC §5, item 15).

## The repo-write authority (why writes from elsewhere fail loudly)

Zenod is the ONLY unit that holds the repo (vault) token. Every commit goes through
`VaultRepo` (`packages/core/src/git/vaultRepo.ts`), constructed with the token in exactly
one place: `Runtime.getRepo()` (`packages/server/src/runtime.ts:296-307`), reading
`vault_repo` + `github_token` (or a GitHub App installation token). No other unit is
handed this token (law 6b). A caller trying to write your memory repo through any other
path has no credential and fails loudly — there is no second door.
