# @zenod/mcp-chassis

Reusable scaffold for Zenod-family MCP units.

```ts
import { createMemoryTenantStore, createUnit } from "@zenod/mcp-chassis";

const unit = createUnit({
  name: "demo",
  version: "0.0.1",
  tenantAuth: {
    store: createMemoryTenantStore([
      { token: "raw-token-shown-once", tenant: { id: "tenant_1" } },
    ]),
  },
  ui: {
    webDist: process.env.ZENOD_WEB_DIST,
    displayName: "Demo",
    tagline: "Demo unit settings",
    panels: ["keys", "connections", "costs"],
  },
  tools(server) {
    server.tool("ping", "Return pong", {}, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
  },
});

export default unit.app;
```

The chassis serves stateless Streamable HTTP at `/mcp` and `/mcp/<token>`.
When `tenantAuth` is configured, raw bearer tokens are SHA-256 hashed before
lookup, only hashes are stored in the tenant table, and `tools` receives the
resolved `context.tenant` for the request. Unknown, disabled, expired, or
mutated tokens return `401` with `WWW-Authenticate`.

`ui` reuses the existing React console build. Token login issues a signed,
tenant-scoped session cookie; `/api/overview`, `/api/keys`, `/api/settings`,
`/api/token`, and `/api/connections` resolve the tenant from that session or a
bearer token and never accept a client-supplied tenant id. `panels` selects which
existing console tabs the unit exposes.

The default settings shell persists `/api/settings` in each tenant's storage
directory. Secret fields are masked on every response, masked values posted back
by the Console leave the stored secret unchanged, and `/api/keys` exposes only
safe metadata for configured secrets. Settings and key metadata survive process
restart without sharing rows or paths between tenants.

Control-plane provisioning is exposed through `POST /api/tenants`,
`PATCH /api/tenants/:tenantId`, `DELETE /api/tenants/:tenantId`, and
`POST /api/tenants/:tenantId/token/rotate` when `controlPlane` is configured.

Billing is opt-in through `billing`:

```ts
const tenants = createMemoryTenantStore();

createUnit({
  name: "demo",
  tenantAuth: { store: tenants },
  controlPlane: { store: tenants },
  billing: {
    store: tenants,
    env: process.env,
  },
});
```

Hosted units should use the chassis-owned durable store and may import an
existing SHA-256 token hash without changing the user's token:

```ts
import { createSqliteTenantStore, createUnit } from "@zenod/mcp-chassis";

const tenants = createSqliteTenantStore({ dataDir: "/data" });
tenants.importTenantTokenHash({
  tokenHash: existingTokenHash,
  tenant: { id: "tenant-1", name: "Tenant 1" },
});

createUnit({
  name: "my-unit",
  tenantAuth: { store: tenants },
  controlPlane: { store: tenants },
  ui: { webDist: "apps/web/dist" },
  routes(routes) {
    routes.get("/api/my-unit/state", (c) => {
      const context = c.get("unitContext");
      return c.json({
        tenant: context.tenant,
        storageRoot: context.storage.rootDir,
        usage: context.usage?.summary() ?? null,
      });
    });
  },
});
```

Every route installed through `routes` is registered before the SPA fallback
and fails closed unless a chassis bearer/OAuth token or signed UI session
resolves the tenant. The injected `unitContext` owns tenant-bound storage,
usage, and operating rules; handlers must not accept a tenant id from input.
Unit routes take precedence over placeholder product APIs such as
`/api/settings`; chassis health, auth, OAuth, control-plane, billing, and MCP
routes remain reserved.

## Structured logging

The chassis emits pino JSON lifecycle logs for every request. Authenticated MCP,
unit-route, and UI work carries `tenant_id`; public, rejected, control-plane,
and other non-tenant work carries an explicit `tenant_id: null`. Every record
also carries `unit_name` and `request_id`, and the same request ID is returned in
`X-Request-Id`.

MCP tools receive the same request-scoped logger:

```ts
createUnit({
  name: "my-unit",
  tools(server, context) {
    server.registerTool("ping", {}, async () => {
      context.logger.info({ operation: "ping" }, "tool invoked");
      return { content: [{ type: "text", text: "pong" }] };
    });
  },
});
```

The default level is `LOG_LEVEL` or `info`. Chassis log serialization redacts
authorization headers, cookies, tokens, OAuth state, API keys, passwords,
credentials, and secrets recursively. Query strings are not logged, and raw
token-bearing MCP paths are normalized to `/mcp/:token`.

The same durable store supports self-host seeding:

```ts
createUnit({
  name: "my-unit",
  tenantAuth: { store: tenants },
  singleTenant: { store: tenants },
});
```

At boot the chassis reads `<UNIT>_API_TOKEN` (falling back to
`ZENOD_API_TOKEN`) and idempotently upserts the `self-host` tenant, so the same
token and tenant survive SQLite reopen/restart.

## Published skill manifest

Declare deployment-owned routing metadata with `skill`:

```ts
createUnit({
  name: "zenod",
  version: "3.2.0",
  skill: {
    id: "zenod.knowledge",
    name: "Zenod Knowledge",
    purpose: "File and retrieve durable knowledge.",
    whenToRoute: ["Use when information should survive the current session."],
    tools: ["ingest", "search"],
    etiquette: ["Treat tools/list as authoritative for live tool schemas."],
    receiptExpectations: ["Writes return a commit SHA or a ticket_id."],
  },
});
```

The chassis publishes the normalized card at public, tenant-neutral
`GET /.well-known/atomic-unit-skill.json`. It generates `schemaVersion` and the
unit `name`/`version` from `createUnit`, and copies only the declared D16
metadata fields; tenant data, credentials, tokens, and installed directives are
never read into this response. The authenticated `/api/skills` response keeps
the same published card under `published` and tenant-installed copies under
`installed`.

The manifest is advisory discovery metadata. MCP `tools/list` and each live
tool schema remain authoritative, and publishing a card grants no authority to
call the unit. A unit without `skill` returns `404` with
`{"error":"skill manifest not configured"}`.

When billing is enabled, the unit serves:

- `POST /api/billing/webhook`
- `GET /checkout/success`
- `GET /checkout/cancel`

Set `BILLING_ENABLED=false` or `MCP_CHASSIS_BILLING_ENABLED=false` to disable
the billing routes. When `STRIPE_WEBHOOK_SECRET` is configured, webhook requests
must carry a valid Stripe `Stripe-Signature` HMAC over the raw request body.
`checkout.session.completed`, active/trialing subscription creates or updates
provision tenant rows; deleted, past-due, unpaid, canceled, or expired
subscriptions suspend tenant rows.

## OAuth kit

`createUnit({ oauth })` can enable both chassis-owned OAuth surfaces:

- `oauth.server: true` installs the MCP-client sign-in server routes:
  `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/authorize`, and `/oauth/token`. Consent authenticates
  with a tenant token, so issued MCP access tokens resolve back to that tenant.
- `oauth.providers` declares outbound/world OAuth providers. The chassis installs
  `/api/oauth/providers/<id>/start` and `/api/oauth/providers/<id>/callback`.
  Start is tenant-authenticated, state is bound to that tenant, callback rejects
  tenant/state mismatches, and exchanged tokens are stored in the tenant vault
  under `oauth:<id>` by default.

Unit tests use a deterministic fake provider, so no external credentials are
needed to prove the framework.

## D18 transcription kit

Import the framework-neutral kit from `@zenod/mcp-chassis/transcription` (or
the package root). A unit supplies provider adapters; the chassis owns the
canonical envelope, tenant-bound credential resolution, one-transcription
decision, provenance, metering, and failure behavior.

```ts
import {
  createTranscriptionKit,
  createVaultTranscriptionProviderResolver,
  type TranscriptionProvider,
} from "@zenod/mcp-chassis/transcription";
import { createSqliteTenantStore, createUnit } from "@zenod/mcp-chassis";

const groq: TranscriptionProvider = {
  id: "groq",
  async transcribe({ media, apiKey, model, signal }) {
    // The adapter may fetch artifact_ref with the owning unit bearer or send
    // bounded inline bytes to its provider. Never put apiKey in the result.
    return {
      text: await callProvider({ media, apiKey, model, signal }),
      usage: { model, billableUnits: 1 },
    };
  },
};

const transcription = createTranscriptionKit({
  unit: { unit: "phylax", version: "3.1.0" },
  resolveProvider: createVaultTranscriptionProviderResolver({
    providers: [{
      provider: groq,
      apiKeyVaultKey: "transcription.groq.api_key",
      modelVaultKey: "transcription.groq.model",
    }],
  }),
});
const tenants = createSqliteTenantStore({ dataDir: "/data" });

createUnit({
  name: "phylax",
  tenantAuth: { store: tenants },
  storage: { dataDir: "/data" },
  routes(routes) {
    routes.post("/api/transcribe", async (c) => {
      const result = await transcription.process(
        c.get("unitContext"),
        await c.req.json(),
      );
      return c.json(result);
    });
  },
});
```

Each tenant selects a provider in its own vault entry
`transcription.provider`; provider definitions name the tenant-local key and
optional model entries. Resolution fails closed without a tenant-bound
`UnitContext`. Raw keys are passed only to the chosen adapter and never enter
results or usage metadata.

The canonical D18 fields are `sender`, `artifact_ref`, `text_transcript`,
`transcription_usage`, `transcription_failed`, and `transcription_source`
(`unit` plus `version`). The strict schemas reject unknown fields, including
`tenant_id`. `channelMediaForwardSchema` requires an HTTPS `artifact_ref` and
forbids inline base64. General media tools may use `inline_media`, bounded to
256 KiB by default (`maxInlineBytes`); larger payloads must use `artifact_ref`.

`process()` returns an explicit `transcription_status`:

- `provided`: a supplied non-empty transcript bypassed provider resolution and
  provider execution. Pass `authenticatedSource` when the first receiver has
  derived the source unit/version from its authenticated connection and D16
  card.
- `performed`: exactly one tenant-resolved adapter call produced text. The kit
  adds source provenance and non-secret usage, then records that usage through
  the same tenant's `UnitContext.usage` meter.
- `failed`: provider resolution or the single adapter attempt failed. The
  result immediately carries `transcription_failed: { code, message }` and the
  original artifact metadata; the kit never retries or queues provider work.

Use `transcriptionPayload(result)` for a later media hand-off, or
`channelMediaForwardPayload(result)` to additionally enforce the artifact-only
channel profile. Both preserve transcript, usage, failure, and original source
provenance. These are media metadata, not mutation evidence: the surrounding
MCP tool must still return an ID/URL/SHA or `{ ticket_id }` under the conduct
receipt rules.
