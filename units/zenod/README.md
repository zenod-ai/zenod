# Zenod — the memory unit

Zenod is a **memory agent** you talk to over plain [MCP](https://modelcontextprotocol.io)
(streamable HTTP). You give it a GitHub repo to use as your memory vault; it stores
what you tell it as immutable evidence + filed meaning with citations, and lets you
search and read it back. Every write lands as a real git commit — Zenod hands you the
commit SHA and GitHub URL as the receipt.

**One box, one endpoint, one repo.** Zenod is the only thing that holds your repo
token. You never write the repo from anywhere else — attempts from another path fail
loudly.

---

## Quickstart — point a plain MCP client at a fresh Zenod

You need: Docker, a GitHub repo you own (empty is fine) + a token that can push to it,
and an LLM key (Anthropic or OpenAI). No suite, no console — just this unit.

### 1. Run a fresh instance

From this folder (`units/zenod/`). Until the repo split fires, the image is the repo
root image with `AGENT=zenod`:

```bash
# from the repo root
docker build -t zenod .

docker run --rm -p 8080:8080 \
  -v "$PWD/zenod-data:/data" \
  -e AGENT=zenod \
  -e ZENOD_DATA_DIR=/data \
  -e VAULT_REPO="your-org/your-memory-repo" \
  -e GITHUB_TOKEN="ghp_xxx_a_token_that_can_push_to_that_repo" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -e ZENOD_API_TOKEN="pick-any-long-secret-string" \
  zenod
```

That is **Option B: configure by hand** — the three env vars above are all Zenod
needs. (In the full suite the keyring/Console mints the MCP token and pushes
`VAULT_REPO` + `GITHUB_TOKEN` + LLM key to `/api/provision` instead; a stranger
self-hosting doesn't need that path.)

Zenod is now serving MCP at **`http://localhost:8080/mcp`**. Check it is up:

```bash
curl -s http://localhost:8080/api/health
```

### 2. Point any MCP client at it

The endpoint is vanilla MCP over streamable HTTP. Any MCP client works — e.g. Claude
Desktop / `claude` with a custom connector, or the reference
`@modelcontextprotocol/inspector`:

```bash
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP
# URL:       http://localhost:8080/mcp
# header:    Authorization: Bearer <token>
```

**Your token.** `/mcp` always requires a bearer token — there is no tokenless mode. You
control it two ways:

- **Pin it (recommended):** set `ZENOD_API_TOKEN` in the run command above to any long
  secret string. That IS your bearer token — use it directly.
- **Don't pin it:** if `ZENOD_API_TOKEN` is unset, Zenod generates a token on first boot
  and **prints it once to the container logs** (`docker logs <container> | grep 'MCP bearer'`).
  Copy it from there.

Send it as `Authorization: Bearer <token>` on every MCP call. (Treat it like a password.
Note: `GET /api/token` is itself auth-gated — you need the token to call it — so use one
of the two paths above to learn it in the first place.)

Run `tools/list`. You should see `store_memory`, `ingest_memory`, `search_memory`,
`get_memory`, `ask_brain`, and `get_task_result` (full surface in
[SEAM-SURFACE.md](./SEAM-SURFACE.md)).

#### Codex Desktop bearer-token setup

Codex Desktop's MCP server settings have two separate concepts:

- **URL:** paste the Zenod MCP URL, for example `https://<host>/mcp`.
- **Bearer token env var:** enter the environment variable name, for example
  `ZENOD_MCP_TOKEN`.

Do not paste the token itself into the `Bearer token env var` field. Codex reads that
field as the name of an environment variable, then reads the actual bearer token from
the Codex process environment.

For Codex CLI, this works when `codex` is launched from the same shell:

```bash
export ZENOD_MCP_TOKEN="<token>"
codex mcp add zenod --url https://<host>/mcp --bearer-token-env-var ZENOD_MCP_TOKEN
```

A normal shell `export` is temporary: it lasts only for that shell session and child
processes. It does not survive a machine restart, and it does not affect an already
running macOS GUI app launched from Finder, Dock, or Spotlight. For Codex Desktop,
set the variable in the environment before starting Codex Desktop, or use a literal
`Authorization: Bearer <token>` header in the MCP server settings.

### 3. Store / search / get

**Store** (mutating, async — returns a `jobId`, then poll):

```jsonc
// tools/call store_memory
{ "content": "My home insurance renews on March 3rd every year." }
// -> returns { jobId: "..." }  (status: queued)

// tools/call get_task_result
{ "jobId": "..." }
// -> when done:
// { status: "done", result: {
//     evidenceRef: "Log/2026-07-05.md#^e-7f3a2c",
//     pagesTouched: ["Areas/Insurance.md"],
//     commitSha: "a1b2c3d...",              // <- your receipt: a real git commit
//     githubUrls: ["https://github.com/your-org/your-memory-repo/blob/main/Areas/Insurance.md"]
// } }
```

Open the `githubUrls` link — the memory is a committed file in **your** repo.

**Ingest media/artifacts** (mutating, async — returns a `jobId`, then poll):

```jsonc
// tools/call ingest_memory
{
  "mediaType": "screenshot",
  "artifactUrl": "https://example.test/screen.png",
  "filename": "screen.png",
  "sourceHint": "Claude upload",
  "contentHint": "remember the renewal date visible in this screenshot",
  "hints": ["insurance"]
}
// -> returns { jobId: "...", kind: "media_ingest", status: "queued" }

// tools/call get_task_result
{ "jobId": "..." }
// -> when done, result includes:
// {
//   status: "done",
//   rawArtifact: { handle, archiveUrl, sha256 },
//   extraction: { handle, ocrHandle, transcriptHandle, archiveUrl, provider },
//   digest: { evidenceRef, pagesTouched, commitSha, githubUrls }
// }
// Opaque handles that Zenod cannot resolve still return a loud
// media_ingest_processor_unavailable receipt instead of fake success.
```

**Search** (read, fast, no LLM):

```jsonc
// tools/call search_memory
{ "query": "insurance renewal" }
// -> hits: [{ path, snippet, score, githubUrl }], or the explicit text
//    "No memories match 'insurance renewal'." when there are none.
```

**Get** (read one note by path from a search hit):

```jsonc
// tools/call get_memory
{ "path": "Areas/Insurance.md" }
// -> { path, frontmatter, body, githubUrl }
```

For fuzzy or cross-note questions ("what do I know about X?"), call **`ask_brain`**
instead of `search_memory` — it runs a read-only research loop and returns a
synthesized answer with cited sources.

---

## What you can rely on (the contract)

- **The endpoint is standard MCP** — nothing custom on the wire. `tools/list` +
  `tools/call` is all a caller needs to know. See [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md).
- **Every write returns a receipt.** `store_memory` gives you a `commitSha` + GitHub
  URL (via `get_task_result`). `ingest_memory` gives an async media receipt with
  raw artifact, extraction/transcript archive, digest, commit, and archive fields.
  A read returns data or an explicit "none". No silent acks; failures error loudly
  with `{ code, message }`.
- **Only Zenod holds your repo token.** It is supplied to this one box (env or
  `/api/provision`) and read in exactly one place internally. Nothing else in the
  suite can write your repo. Any write attempt down another path fails loudly.
- **Your memory is just a git repo.** Clone it, read it, leave — no lock-in.

## Files in this unit

| File | What it is |
|---|---|
| `README.md` | this quickstart (an acceptance item) |
| `SEAM-SURFACE.md` | the MCP tool surface + receipt shapes |
| `EXTRACTION-MAP.md` | file-level extraction map (blueprint, RD-4 staged) |
| `Dockerfile` | root-image-reuse note (staged; build from repo-root `Dockerfile`) |
| `docker-compose.zenod.yml` | deploy stub |

> **Status honesty:** this folder is the *seam of record* for Zenod-as-a-unit. The
> physical extraction from the fused Console is STAGED behind the RD-4 split trigger
> and has not fired — see `EXTRACTION-MAP.md`. The running behavior above is real
> today (image with `AGENT=zenod`); the standalone folder is blueprint.
