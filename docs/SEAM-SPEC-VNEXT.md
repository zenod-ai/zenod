# SEAM-SPEC vNext - multi-tenant unit contract

Owner: Epic 3.1 ([EPIC-3.1-MCP-CHASSIS.md](EPIC-3.1-MCP-CHASSIS.md), ticket C-8).
Status: draft for Epic 3.1 review, 2026-07-10. Extends
[SEAM-SPEC v1](SEAM-SPEC.md) and the chassis architecture in
[MCP-CHASSIS-SPEC.md](MCP-CHASSIS-SPEC.md). Parent decisions D16
(skill-per-connected-MCP) and D18 (transcription at the edge, once) in
[EPIC-3.0-CHASSIS-REPLATFORM.md](EPIC-3.0-CHASSIS-REPLATFORM.md) are normative
through the rows and checks below.

This document is language-agnostic. Node units can satisfy it by using
`@zenod/mcp-chassis`; non-Node units, especially Callisthenes, satisfy the same
wire and operations contract directly.

## 0. Additive rule

SEAM-SPEC v1 remains normative. vNext adds tenancy, control-plane, container,
OAuth, billing, and unit-UI obligations. It does not weaken any v1 receipt law:

- Mutating fast tools still MUST return at least one concrete evidence handle
  such as an ID, URL, or SHA.
- Reads still MUST return data or an explicit empty/null state, never a bare
  success.
- Long tools still MUST return `{ ticket_id }` immediately, emit/persist a
  terminal result with the same `ticket_id`, and expose a poll tool.
- Failures still MUST be loud structured errors with stable codes. Success-shaped
  failures are nonconformant.
- Dispatch still forms a tree, with depth <= 1 and `origin_ticket_id`
  propagation.
- Per-unit bearer auth still gates the MCP surface. vNext defines how that
  bearer resolves to a tenant.
- Published skill metadata supplements MCP `tools/list`; it never replaces the
  standard MCP discovery or tool-schema surface and never grants authority.
- Media hand-off remains a standard MCP tool call. An `artifact_ref` is a data
  handle, not a second command, dispatch, or receipt protocol.

If this document and v1 appear to conflict, choose the stricter requirement and
record the ambiguity in the bound Epic 3.1 issue.

## 1. Unit model

A unit is one always-on container that serves:

- one MCP endpoint for all tenants;
- one tenant-scoped human settings or connection UI;
- one control-plane provisioning surface;
- one health surface;
- one durable data volume.

A new customer is a tenant row, not a deploy. Hosted and self-hosted use the
same image. Self-hosted mode is the identical product with exactly one seeded
tenant.

Suites compose units by provisioning machine tenants and storing agent-to-unit
tokens. Units stay suite-agnostic.

## 2. Contract table

| Area | vNext requirement | v1 receipt law impact | Current chassis / unit notes |
|---|---|---|---|
| Transport | Every unit exposes Streamable HTTP MCP at `/mcp`. The transport is stateless per request; no custom wire framing or bespoke payload envelope is allowed. A tokened URL form `/mcp/<token>` MAY be accepted for client ergonomics, but it MUST resolve to the same bearer identity rules as `Authorization: Bearer`. | Preserves v1 transport and receipt profile. Tool results and errors remain MCP-shaped. | `packages/server/src/app.ts` already constructs a fresh `StreamableHTTPServerTransport` per `/mcp` request; chassis extracts this shape. |
| Auth | Every MCP call carries a per-unit bearer. The unit resolves `tenant_id` by hashing the presented bearer with SHA-256 and looking up a tenant/token row. Unknown, disabled, expired, or revoked tokens return 401 plus a loud `unauthorized` error; MCP HTTP failures include `WWW-Authenticate` where OAuth discovery applies. Raw tokens are shown once at mint and stored only as hashes. | Strengthens v1 auth by making bearer identity tenant identity. No client can assert tenant as a tool argument. | Node chassis upgrades `requireMcpAuth`; Callisthenes must bind FastMCP request bearer resolution to the same lookup semantics. |
| Tenancy | Every read, write, job, usage row, vault key, connection, OAuth grant, and UI session is scoped by resolved `tenant_id`. Public tool schemas MUST NOT expose `tenant_id`, `mcp_token`, or equivalent identity selectors. Cross-tenant reads/writes MUST fail loudly. | Extends v1 auth and receipt laws. Receipts MUST be tenant-local evidence handles. | The three-tenant browser E2E is the primary proof: tenant A can never observe tenant B or C state. |
| Provisioning | `POST /api/tenants` creates a tenant row and mints a raw token once. `DELETE /api/tenants/:id`, suspend, and token rotation are control-plane actions. All provisioning endpoints are guarded by `CONTROL_PLANE_TOKEN` and return concrete tenant/token rotation evidence or loud errors. New hosted customer means insert/update rows, never a Dokploy app. | Mutating endpoints follow the same receipt discipline: tenant ID, token ID/hash prefix, URL, or rotation handle. | Replaces per-tenant Dokploy provisioning and watchdog registration from the Epic 2 hosted model. |
| Storage | Unit code never opens global paths directly. It receives tenant-scoped handles such as `storage.db(tenant)` and `storage.dir(tenant)`. File state lives under `/data/<tenant_id>/...`; relational state is tenant-keyed. World credentials and secret settings use authenticated encryption at rest, including SQLite DB/WAL/SHM custody. Missing or wrong keys fail closed before mutation. The storage implementation is swappable behind the same API. | Reads return tenant-local data or explicit empty states. Mutations return handles inside the tenant namespace. | Epic 3.0 D4 decided SQLite/WAL per unit behind the chassis storage seam, with Postgres reserved as a future seam implementation. Legacy plaintext migration requires old writers stopped, then checkpoint/VACUUM/truncate cleanup before completion. |
| Health | `GET /healthz` returns HTTP 200 when the unit can serve MCP and its tenant store is reachable. The JSON body includes at least `status`, unit `name`, `version`, and `sha` or build identifier. Health MUST NOT leak tenant tokens or tenant data. | Health is not a tool receipt, but it follows loud failure semantics: non-healthy means non-200 or explicit degraded status. | Existing Node app has `/api/health`; vNext standardizes `/healthz` for static per-unit watchdog checks. |
| Env | Required hosted env: `PORT`, `<UNIT>_DATA_DIR` or equivalent data root, `CONTROL_PLANE_TOKEN`, token/session secrets, public base URL, a stable unique-per-unit 32-byte chassis vault master key kept outside the data root, and any unit-specific connector secrets. Required self-host env: a single-tenant seed token such as `<UNIT>_API_TOKEN`, data root, and the same stable vault-key contract when encrypted custody is used. Missing required env fails startup or disables only the dependent feature loudly. | Prevents silent no-op features and success-shaped configuration failures. | Self-host seed creates one tenant at boot using the same tenant table and UI. The key must remain unchanged across restart/restore; automatic key generation or silent rotation is forbidden. |
| Container | One Dockerfile/image per unit. The image exposes the HTTP port, declares or documents `/data`, runs the MCP endpoint and UI in the same process/app boundary unless the unit documents an internal compose, and uses restart policy suitable for always-on service. | Container shape cannot bypass v1 by offering side channels. All external machine calls still go through MCP. | Epaminon may spawn per-job sandboxes, but the Epaminon API container remains the unit. Phylax keeps its phone-number gateway exception. |
| DNS | One public hostname per unit, for example `<unit>.zenod.dev`. Tenants do not get per-tenant subdomains. Tokened MCP URLs are paths under the unit hostname. Internal-only gateways, such as Phylax phone-number plumbing, are documented as non-public exceptions. | Single endpoint preserves the v1 "one MCP server" expectation at the unit address. | Deletes per-tenant DNS minting and TLS sprawl. |
| Deploy | Deploying code rebuilds/restarts the unit application once. Adding, suspending, deleting, or rotating a customer does not deploy anything. Watchdog configuration is a static list of unit `/healthz` URLs. | Deploys cannot be used as hidden receipts for tenant actions. Tenant changes still need explicit control-plane receipts. | Default integration target remains `main`; Dokploy application count is per unit, not per user. |
| OAuth server kit | Units that support MCP-client sign-in expose standards-based OAuth metadata and token exchange for clients such as Claude.ai or Claude Code. OAuth access tokens map to a tenant, not to unscoped process authority. OAuth errors include `WWW-Authenticate` where applicable and fail loudly. | Keeps v1 bearer auth while allowing standards-based bearer acquisition. | Existing Node server has OAuth metadata and token handling; chassis makes tenant mapping first-class. |
| OAuth client kit | User/world connections, such as GitHub, Google Drive, X, Reddit, email, or worker CLI credentials, are connected inside the tenant-scoped UI or chat-auth surface. Callback state binds to the tenant session. Stored world credentials live in tenant vault/custody and are never returned in tool receipts or logs. | Mutating connect/revoke flows return non-secret evidence: connected service, granted scope, account handle, or revocation count. | Callisthenes has a per-tenant chat-auth package and `/connect` surface; vNext requires it to bind into the shared tenant identity and custody model. |
| Billing webhook | A unit MAY expose `/api/billing/webhook` or receive provisioning calls from a control-plane billing service. In either shape, signed Stripe events resolve to explicit tenant create/update/suspend/quota actions. Invalid signatures and mode mismatches fail loudly. | Billing mutation receipts name the tenant/action and never report success before the row is durable. | The final fleet target has each unit able to receive the chassis billing contract; the control plane may still orchestrate calls to `/api/tenants`. |
| Conduct and directives UI | Every unit UI includes or plugs into tenant-scoped panels for operating rules, MCP/client config, skill/settings, standing directives, keys/connections, usage, and costs as applicable. Conduct settings are data, not image-baked behavior, and tool behavior must still obey v1 receipts, reply gates, ticket propagation, and loud errors. | The UI cannot authorize silent acks or hidden side effects. Directives that cause mutations still need evidence handles. | Chassis provides the shell; each unit contributes domain panels, such as Callisthenes throttle/receipts/connection status or Zenod vault/transcription panels. |
| Published skill manifest (D16) | Every unit MUST publish a tenant-neutral JSON usage card at `GET /.well-known/atomic-unit-skill.json`. The card MUST contain a schema version, stable skill ID, unit name and version, purpose, when-to-route guidance, MCP tool identifiers, tool etiquette, and receipt expectations. It MAY advertise a same-origin `zenod-agent-skill-bundle-v1` URL containing the canonical Agent Skill files. It MUST contain no tenant data, tokens, connector credentials, or tenant-installed directives. Wiring a unit into a wallet imports the advertised bundle when present, otherwise the card; consumers refresh metadata when its unit or schema version changes. Manual tenant replacement or detachment remains authoritative and MUST NOT mutate the publisher. | The card and bundle are advisory discovery only: `tools/list` and each live MCP tool schema remain authoritative, bearer auth still gates calls, and every listed tool remains subject to v1 receipts, tickets, dispatch depth, and loud errors. A manifest is never an authority grant or evidence that a mutation occurred. Wallets reject cross-origin bundle URLs/redirects, enforce bounded files/bytes, store content-addressed copies, load prose progressively, and never execute advertised scripts. | Node units declare the card through `createUnit({ skill })`; non-Node units serve the same JSON semantics directly. The skill-settings UI renders the published card and the tenant's installed copies. Publishing a new card/bundle is part of a unit code deploy, not tenant provisioning. |
| Channel media forward (D18) | A channel unit that receives media MUST attempt transcription at the edge before forwarding a standard MCP tool call. Its forward arguments use `{ sender, artifact_ref, text_transcript?, transcription_usage?, transcription_failed? }`. `sender` is channel identity, never `tenant_id`. `artifact_ref` is an HTTPS URL for the immutable media, fetchable from the owning unit with a standard per-unit bearer that resolves to the same tenant rules as MCP; cross-tenant fetches MUST fail. On success, `text_transcript` is non-empty and `transcription_usage` carries non-secret structured metering data sufficient for downstream tenant attribution. The receiver derives the transcribing unit and version from the authenticated connection plus its published D16 card; caller-supplied `sender` MUST NOT override that provenance. If the STT provider fails, the unit MUST forward immediately with `transcription_failed: { code, message }` and the artifact reference; it MUST NOT queue the conversation behind provider recovery. Successful edge transcription and `transcription_failed` are mutually exclusive. Inline base64 MUST NOT be used for channel media; other media tools MAY advertise and enforce a finite small-payload limit, above which `artifact_ref` is mandatory. | The forward is an ordinary MCP tool call, not a bespoke envelope or side-channel dispatch. A mutating forward still returns evidence or a `ticket_id`; `transcription_failed` reports degraded input and does not permit a silent ack or success-shaped tool failure. Any async archive retains the same ticket/receipt discipline, `origin_ticket_id`, and depth <= 1. | Phylax owns channel-media expertise and its tenant-scoped transcription key, but no routing intelligence. The Ring maps `sender` to its tenant, books `transcription_usage` there, and routes from the received text. Artifact bytes may be fetched over authenticated HTTPS, but all control and routing remain standard MCP. |
| Pre-transcribed media ingest (D18) | Any unit that can invoke STT for received media MUST also accept the media with an optional pre-made transcript and source unit/version provenance. When a transcript is present, it MUST bypass its own STT, persist the supplied text, and record provenance such as `transcribed by phylax@<version>`. The transcript and provenance MUST travel with the artifact on every later hand-off. When media arrives without a transcript, or with `transcription_failed`, the receiving unit MAY transcribe with its own configured provider. It MUST NOT transcribe twice. Tool-specific schemas MAY map the channel fields into a documented transcript object, but MUST preserve `text_transcript`, source/version, `artifact_ref`, usage, and failure semantics without a bespoke transport wrapper. | Ingest and archive mutations still return concrete evidence or a ticket. The final receipt MUST state whether transcription was `provided`, `performed`, or `failed`, so duplicate STT is observable and testable. Provenance and usage are tenant-scoped metadata and never replace the evidence handle. | Node units use the shared chassis transcription seam with per-unit tenant custody; other stacks implement the same behavior directly. Zenod retains STT for direct/Drive media that has no transcript and skips it for Phylax-provided text. |

## 3. Self-host parity

Self-hosting is not a separate edition:

| Concern | Hosted | Self-hosted |
|---|---|---|
| Image | Same registry image. | Same registry image. |
| Tenant count | Many rows. | One boot-seeded row. |
| Provisioning | Billing/control plane calls `/api/tenants`. | No external provisioning path unless `CONTROL_PLANE_TOKEN` is set deliberately. |
| Auth | Bearer or OAuth token maps to a tenant row. | Seed bearer maps to the single tenant row. |
| UI | Full tenant-scoped UI. | Same full UI. |
| Storage | `/data/<tenant_id>/...` or tenant-keyed rows. | Same layout with one tenant. |
| Metering | Enforced by plan/quota. | Same ledger; quota may be unlimited but usage remains visible. |
| Skill manifest | Same versioned tenant-neutral usage card. | Same card from the same image; no tenant-specific fork. |
| Media/STT | Tenant-scoped artifact access, usage, and provenance. | Same one-transcription and artifact-reference rules when the unit has media/STT capability. |

## 4. Conformance checklist delta

A vNext tester first runs the SEAM-SPEC v1 checklist, then adds these checks:

1. **[auth/tenancy]** Two valid bearers resolve to two tenant identities; each can
   call `tools/list`, and an invalid bearer gets 401 plus `unauthorized`.
2. **[auth/tenancy]** Tenant A creates or connects something; Tenant B cannot read,
   use, revoke, or observe it.
3. **[schema]** No public MCP tool accepts a tenant selector such as `tenant_id`,
   `mcp_token`, or raw bearer.
4. **[provisioning]** `POST /api/tenants` with `CONTROL_PLANE_TOKEN` creates a
   tenant and returns concrete non-secret evidence.
5. **[provisioning]** The same endpoint without the control-plane token fails
   loudly and creates no tenant.
6. **[rotation]** Rotating a token invalidates the old bearer and returns a new
   token exactly once.
7. **[storage]** Tenant state lands only under `/data/<tenant_id>/...` or in
   tenant-keyed rows.
8. **[health]** `GET /healthz` returns unit name, version, and build identifier
   without tenant data.
9. **[self-host]** Boot with a seed token creates exactly one tenant and the same
   MCP/UI surfaces work.
10. **[billing]** A signed billing event or equivalent control-plane provisioning
    call creates/updates/suspends a tenant with durable evidence.
11. **[oauth-server]** OAuth-discovered client tokens map to a tenant and cannot
    access another tenant.
12. **[oauth-client]** World-connection callbacks bind to the tenant session and
    store non-public credentials in tenant custody.
13. **[conduct-ui]** Tenant directives/settings change behavior only after a
    receipted save and are visible only to that tenant.
14. **[deploy]** Adding a tenant requires no container, DNS, or watchdog change.
15. **[skill/D16]** `GET /.well-known/atomic-unit-skill.json` returns the
    versioned purpose, routing guidance, tool identifiers, etiquette, receipt
    expectations, and optional same-origin bundle pointer, with no tenant data
    or secrets.
16. **[skill/D16]** Wiring the unit imports its advertised bundle/card while an
    MCP client can still drive the unit from `tools/list`; cross-origin,
    oversized, malformed, or redirected bundles are ignored without breaking
    tool discovery, and changing a tenant's installed copy does not mutate the
    published artifact or another tenant's copy.
17. **[media/D18]** A channel media forward uses the canonical sender,
    `artifact_ref`, transcript/usage/failure fields inside a standard MCP tool
    call; an artifact fetched with another tenant's bearer is refused.
18. **[media/D18]** A successful edge transcript causes zero downstream STT
    provider calls, records source-unit/version provenance, and remains attached
    on the next hand-off.
19. **[media/D18]** A forced edge-STT failure forwards immediately with
    `transcription_failed` plus `artifact_ref`; a downstream unit may transcribe
    once and the receipt makes the performed branch explicit.
20. **[receipt/D18]** Forward/ingest/archive mutations still return evidence or
    `{ ticket_id }`, preserve `origin_ticket_id` and depth <= 1, and never treat
    a transcription marker as a silent success receipt.

## 5. Callisthenes conformance gaps

Callisthenes remains Python/FastMCP. It should not be rewritten to Node; it must
conform by contract. Its current surface already satisfies the v1 fast-tool
receipt profile for X/Reddit send tools and has partial per-tenant chat-auth
work. The remaining vNext gaps are:

| Gap | Required vNext behavior | Current evidence | Target owner |
|---|---|---|---|
| Tenant lookup table | MCP bearer resolves through a tenant/token table using `sha256(bearer)`; disabled or unknown tenants fail 401/`unauthorized`. | `units/callisthenes/auth/` hashes tokens for connection custody, and `SEAM-SURFACE.md` still records bearer validation as an open integration seam. | Epic 3.3 Callisthenes conformance |
| Public tenant schema | No tool exposes tenant identity; tenant is injected from the authenticated request. | `auth/register()` drops the tenant parameter for chat-auth tools, but the live FastMCP wrapper must prove this for the full mounted tool set. | Epic 3.3 |
| Provisioning API | `POST /api/tenants`, suspend/delete, and rotate are guarded by `CONTROL_PLANE_TOKEN` and return non-secret evidence. | Current Callisthenes docs describe `/connect` and OAuth routes, not `/api/tenants`. | Epic 3.3 |
| Billing webhook / billing bridge | Signed Stripe event or control-plane call creates/updates/suspends the Callisthenes tenant row. | No current Callisthenes surface documents `/api/billing/webhook`; prior docs mention cloud/provisioner ownership. | Epic 3.3 plus control-plane worker |
| Tenant-scoped storage layout | All custody, throttle, send ledger, and usage data is under `/data/<tenant_id>/...` or tenant-keyed rows. | `auth/token_store.py` keys connections by token hash; `usage_reader.py` documents that `llm_usage` has no tenant column and `sends` is still `null` without a send ledger. | Epic 3.3 storage/metering |
| Health endpoint | `GET /healthz` returns standard unit health with version/build and no tenant data. | Current required surface only names MCP and `/connect`; no standard `/healthz` contract is recorded for Callisthenes. | Epic 3.3 |
| OAuth client custody | X/Reddit connection flows bind callback state to the resolved tenant, store secrets in tenant custody, and return only non-secret account/scope receipts. | `auth/README.md` defines PKCE/chat-auth and hashed token custody; live hosted integration still needs end-to-end proof against the request tenant. | Epic 3.3 |
| Single-tenant self-host | Seed env creates one tenant row and the same UI/MCP paths work. | Current Callisthenes supports single-owner env OAuth fallback; it is not yet the same tenant-table path as hosted. | Epic 3.3 |
| Conduct/directives UI | Tenant UI exposes throttle, receipts, usage, connection state, operating rules, and send directives without image-baked tenant data. | `/connect` covers connections; throttle/receipts exist in tool behavior; no complete vNext tenant settings shell is documented. | Epic 3.3 |
| Published skill manifest (D16) | Serve `/.well-known/atomic-unit-skill.json` with the same required version, purpose, routing, tools, etiquette, and receipt fields as a Node unit; keep `tools/list` authoritative. | Callisthenes does not inherit `createUnit({ skill })`; conformance therefore requires an explicit FastMCP/Starlette route and a captured JSON response, not a Node-package assertion. | Epic 3.3 |
| Media transcription profile (D18) | If Callisthenes exposes a channel-ingress or STT-capable media tool, it implements the canonical forward/pre-transcribed-ingest behavior and proves the zero-double-STT path. If it exposes neither capability, the D18 checks are N/A only with captured `tools/list` and tool-schema evidence. Ordinary social-media send attachments alone do not imply STT capability. | No Callisthenes channel-ingress or STT seam is established in the current contract evidence. Stack or language is not an exemption when the capability exists. | Epic 3.3 |

The Callisthenes tester MUST run the same wire-level checks with a plain MCP and
HTTP client. Python types, FastMCP decorators, or the absence of the Node chassis
are not conformance evidence by themselves.

## 6. Nonconformance examples

These are vNext failures even if the unit still responds over MCP:

- A tool accepts `tenant_id` from the caller.
- A tenant action creates a Dokploy app, DNS record, or watchdog row.
- A send succeeds but returns no post ID, permalink, media ID, or other evidence.
- A billing webhook returns 200 before tenant mutation is durable.
- A world OAuth callback stores credentials without tenant-bound state validation.
- A self-host image omits the hosted UI or uses a different code path.
- A unit logs raw bearer tokens, OAuth refresh tokens, or world credentials.
- A wallet relies on hand-maintained skill prose when the connected unit has no
  versioned published manifest, or treats that manifest as an authority grant.
- A channel forwards media as inline base64, drops a successful transcript, or
  waits indefinitely after its edge STT provider fails.
- A receiving unit invokes STT when a pre-made transcript is present, or drops
  the transcript/source provenance on a later artifact hand-off.
- An artifact URL can be fetched with another tenant's bearer or without the
  owning unit's normal bearer validation.

## 7. Adoption notes

- `@zenod/mcp-chassis` is the reference implementation for Node units.
- Callisthenes is the first non-Node proof. Passing vNext means the contract is
  truly language-agnostic; its skill route and every applicable D18 behavior are
  validated at the wire, not inferred from framework internals.
- Until Epic 3.1 freezes the chassis API, vNext should be treated as the
  acceptance target for 3.2-3.6 tickets, not as a deployed runtime claim.
