import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import type { StoreResult, TrustedConnectionProfile } from "zenod";
import { VERSION } from "zenod/version";
import { durableStoreReceiptError } from "./durableReceipt.js";
import { validateWalletUrl } from "./walletUrl.js";
import {
  PEER_SKILL_LIMITS,
  type PeerSkillAttachmentRef,
  type PeerSkillFileInput,
} from "./peerSkillStore.js";

/**
 * The mesh: one agent calling another over MCP. A peer agent exposes its tools at
 * an MCP endpoint (e.g. https://c1.zenod.dev/mcp); we connect as a client with a
 * bearer token and call one of its tools. This is how the vaultless Console
 * delegates a memory question to Zenod (`ask_brain`) — it has no vault of its own.
 */
/** One tool this peer exposes to our chat: a friendly name → one of the peer's MCP tools. */
export interface PeerToolSpec {
  /** Tool name shown to our LLM, e.g. "add_memory". */
  as: string;
  /** The peer's MCP tool to call, e.g. "store_memory". */
  mcp: string;
  /** The single argument key that MCP tool takes, e.g. "content". */
  arg: string;
  /** Optional schema key for typed peer tools whose arguments should pass through unchanged. */
  inputSchema?: string | Record<string, unknown>;
  /** Optional MCP output schema, retained verbatim for inspection/refresh. */
  outputSchema?: Record<string, unknown>;
  /** Loud per-field degradation when an optional output schema exceeds Ring's bound. */
  outputSchemaError?: string;
  /** What the tool does (the model reads this). */
  description: string;
  /** MCP tool behavior hints copied from tools/list when discovery is available. */
  annotations?: { readOnlyHint?: boolean; [key: string]: unknown };
  /** Discovered tools retain the complete MCP CallToolResult envelope. */
  preserveFullResult?: boolean;
}

export interface PeerConfig {
  /** Short id, e.g. "zenod" — surfaced to the chat as the tool `ask_<name>`. */
  name: string;
  /** The peer's MCP endpoint URL, e.g. https://c1.zenod.dev/mcp */
  url: string;
  /** Bearer token the peer accepts (its api_token, or an OAuth token). */
  token: string;
  /** The peer MCP tool to call (legacy single-tool peers). Defaults to ask_brain. */
  tool?: string;
  /** Curated set of the peer's tools to expose (e.g. Zenod's memory toolset). */
  tools?: PeerToolSpec[];
  /**
   * The repo this peer was provisioned with (vault for memory agents, central
   * backlog for backlog agents). Kept on the Console purely for display + the
   * "Manage" affordance in the Team tab; the agent remains the source of truth.
   */
  repo?: string;
  /** Ring tenant wallet entry; requires downstream SSRF validation on every call. */
  wallet?: boolean;
  /** Set only by server policy when the exact host belongs to the private unit fleet. */
  allowPrivateHost?: boolean;
  /** Host-owned, tenant-local risk limits for this exact connection. */
  trustedProfile?: TrustedConnectionProfile;
  /** Last authenticated discovery state. Transport and catalog readiness differ. */
  discovery?: {
    transport: "connected" | "error";
    tools: "ready" | "error";
    error?: string;
    refreshedAt: string;
  };
  /** Tenant-local immutable skill artifact reference. The bundle itself is never stored in settings. */
  skillArtifact?: PeerSkillAttachmentRef;
  /** False after an explicit manual detach; refresh must not silently re-import. */
  skillAutoImport?: boolean;
}

async function validatePeerTarget(peer: PeerConfig): Promise<void> {
  if (!peer.wallet) return;
  const hostname = new URL(peer.url).hostname.replace(/^\[|\]$/g, "");
  await validateWalletUrl(peer.url, { allowHosts: peer.allowPrivateHost ? [hostname] : [] });
}

export async function probePeer(peer: PeerConfig): Promise<"connected" | "error"> {
  try {
    await validatePeerTarget(peer);
    const client = new Client({ name: "zenod-wallet-probe", version: VERSION }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${peer.token}` },
        signal: AbortSignal.timeout(5_000),
      },
    });
    try {
      await client.connect(transport);
      await client.listTools();
      return "connected";
    } finally {
      await client.close().catch(() => {});
    }
  } catch {
    return "error";
  }
}

export interface PeerDiscoveryResult {
  transport: "connected" | "error";
  tools: "ready" | "error";
  specs: PeerToolSpec[];
  error?: string;
}

const MAX_DISCOVERED_TOOLS = 64;
const MAX_TOOL_DESCRIPTION_CHARS = 4_000;
const MAX_TOOL_SCHEMA_BYTES = 64 * 1024;
const PUBLISHED_SKILL_MANIFEST_PATH =
  "/.well-known/atomic-unit-skill.json";

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PEER_SKILL_LIMITS.maxBundleBytes) {
    throw new Error("advertised skill response is too large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > PEER_SKILL_LIMITS.maxBundleBytes) {
    throw new Error("advertised skill response is too large");
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

/**
 * Importable peer guidance is optional advisory metadata. Discovery is public,
 * same-origin and redirect-free; MCP tools remain usable when it is absent or bad.
 */
export async function discoverAdvertisedPeerSkill(
  peer: PeerConfig,
): Promise<PeerSkillFileInput[] | null> {
  try {
    await validatePeerTarget(peer);
    const peerUrl = new URL(peer.url);
    const manifestUrl = new URL(PUBLISHED_SKILL_MANIFEST_PATH, peerUrl.origin);
    const manifestResponse = await fetch(manifestUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!manifestResponse.ok) return null;
    const manifest = await boundedJson(manifestResponse) as {
      bundle?: { format?: unknown; url?: unknown };
    };
    if (
      manifest?.bundle?.format !== "zenod-agent-skill-bundle-v1" ||
      typeof manifest.bundle.url !== "string"
    ) {
      return null;
    }
    const bundleUrl = new URL(manifest.bundle.url, manifestUrl);
    if (bundleUrl.origin !== peerUrl.origin) return null;
    const bundleResponse = await fetch(bundleUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!bundleResponse.ok) return null;
    const bundle = await boundedJson(bundleResponse) as {
      format?: unknown;
      files?: unknown;
    };
    if (
      bundle?.format !== "zenod-agent-skill-bundle-v1" ||
      !Array.isArray(bundle.files)
    ) {
      return null;
    }
    return bundle.files as PeerSkillFileInput[];
  } catch {
    return null;
  }
}

function boundedSchema(value: unknown, label: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_TOOL_SCHEMA_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_TOOL_SCHEMA_BYTES}-byte discovery limit`);
  }
  return JSON.parse(encoded) as Record<string, unknown>;
}

function boundedOptionalOutputSchema(
  value: unknown,
  label: string,
): { schema?: Record<string, unknown>; error?: string } {
  try {
    const schema = boundedSchema(value, label);
    return schema ? { schema } : {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${label} is unavailable` };
  }
}

function stableToolSegment(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();
  return (safe || "tool").slice(0, 22);
}

/** Deterministic namespace prevents one wallet peer from shadowing another. */
export function councilToolName(peerName: string, mcpToolName: string): string {
  const digest = createHash("sha256")
    .update(peerName)
    .update("\0")
    .update(mcpToolName)
    .digest("hex")
    .slice(0, 16);
  return `${stableToolSegment(peerName)}__${stableToolSegment(mcpToolName)}__${digest}`;
}

/**
 * Opaque identity for the exact configured connection. Standing approvals must
 * not survive an endpoint or credential replacement under the same display name.
 */
export function peerApprovalConnectionId(
  peer: Pick<PeerConfig, "name" | "url" | "token">,
): string {
  const digest = createHash("sha256")
    .update(peer.name)
    .update("\0")
    .update(peer.url)
    .update("\0")
    .update(peer.token)
    .digest("hex")
    .slice(0, 32);
  return `connection:${stableToolSegment(peer.name)}:${digest}`;
}

/**
 * Authenticated MCP discovery for one wallet peer. The advertised catalog is the
 * authority: descriptions, schemas and annotations are copied without profiles.
 */
export async function discoverPeerTools(peer: PeerConfig): Promise<PeerDiscoveryResult> {
  try {
    await validatePeerTarget(peer);
  } catch (err) {
    return { transport: "error", tools: "error", specs: [], error: (err as Error).message };
  }
  const client = new Client({ name: "zenod-wallet-discovery", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${peer.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  });
  let connected = false;
  try {
    await client.connect(transport);
    connected = true;
    const listed = await client.listTools();
    if (listed.tools.length > MAX_DISCOVERED_TOOLS) {
      throw new Error(`tools/list returned ${listed.tools.length} tools; maximum is ${MAX_DISCOVERED_TOOLS}`);
    }
    if (new Set(listed.tools.map((tool) => tool.name)).size !== listed.tools.length) {
      throw new Error("tools/list returned duplicate tool names");
    }
    const specs = listed.tools.map((tool) => {
      const output = boundedOptionalOutputSchema(tool.outputSchema, `${tool.name} outputSchema`);
      return {
        as: councilToolName(peer.name, tool.name),
        mcp: tool.name,
        arg: "input",
        inputSchema: boundedSchema(tool.inputSchema, `${tool.name} inputSchema`) ?? { type: "object" },
        ...(output.schema ? { outputSchema: output.schema } : {}),
        ...(output.error ? { outputSchemaError: output.error } : {}),
        description: (tool.description?.trim() || `Call ${tool.name} on the ${peer.name} peer.`).slice(0, MAX_TOOL_DESCRIPTION_CHARS),
        ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
        preserveFullResult: true,
      };
    });
    if (new Set(specs.map((spec) => spec.as)).size !== specs.length) {
      throw new Error("tools/list produced colliding Council tool names");
    }
    return { transport: "connected", tools: "ready", specs };
  } catch (err) {
    return {
      transport: connected ? "connected" : "error",
      tools: "error",
      specs: [],
      error: (err as Error).message,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function extractText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/**
 * Call a peer agent's MCP tool once and return its text answer. Each call opens
 * and closes its own short-lived connection — simple and stateless, which is all
 * a single delegation needs. Errors are returned as a readable string so the
 * caller's model can relay a graceful failure rather than throwing mid-turn.
 */
export async function callPeer(
  peer: PeerConfig,
  mcpTool: string,
  argKey: string,
  input: string,
  extraArgs: Record<string, unknown> = {},
): Promise<string> {
  try {
    await validatePeerTarget(peer);
  } catch (err) {
    return `Could not reach peer agent "${peer.name}": ${(err as Error).message}`;
  }
  const client = new Client({ name: "zenod-mesh-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: { headers: { Authorization: `Bearer ${peer.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: { ...extraArgs, [argKey]: input } });
    const text = extractText(result);
    return text || `(${peer.name} returned an empty answer)`;
  } catch (err) {
    return `Could not reach peer agent "${peer.name}": ${(err as Error).message}`;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Raw passthrough result of a peer tool call — shaped like an MCP tool response
 * (CallToolResult), so a gateway execute can return it directly. The index
 * signature mirrors the SDK's result type (it carries optional _meta etc.).
 */
export type PeerToolResult = CallToolResult;

export interface PeerMcpJobPollResult {
  status: "done" | "error" | "timeout";
  error?: string;
  kind?: string;
  result?: unknown;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function typedPeerJobTerminal(
  response: PeerToolResult,
  expectedJobId: string,
): PeerMcpJobPollResult | null {
  const structured = objectRecord(response.structuredContent);
  if (!structured) return null;
  const responseJobId = structured.ticket_id ?? structured.jobId;
  if (responseJobId !== expectedJobId) {
    return { status: "error", error: "Peer returned a receipt for a different job." };
  }
  const state = structured.state ?? structured.status;
  if (state === "done") {
    return {
      status: "done",
      ...(typeof structured.kind === "string" ? { kind: structured.kind } : {}),
      result: structured.result,
    };
  }
  if (state === "error" || state === "interrupted") {
    const error = objectRecord(structured.error);
    return {
      status: "error",
      error: typeof error?.message === "string"
        ? error.message
        : `Peer job ${state}.`,
    };
  }
  return null;
}

/**
 * Call a peer's MCP tool with a FULL argument object and relay its result
 * unchanged. This is the mesh GATEWAY primitive: the Console re-publishes a
 * peer's real tool and forwards the external caller's arguments straight through,
 * returning the peer's response verbatim — no LLM in the path. A connection
 * failure comes back as an isError result so the caller sees a graceful error.
 */
export async function callPeerTool(
  peer: PeerConfig,
  mcpTool: string,
  args: Record<string, unknown>,
): Promise<PeerToolResult> {
  try {
    await validatePeerTarget(peer);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Could not reach peer agent "${peer.name}": ${(err as Error).message}` }],
      isError: true,
    };
  }
  const client = new Client({ name: "zenod-mesh-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: { headers: { Authorization: `Bearer ${peer.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: args });
    const rawContent = Array.isArray(result.content) ? result.content : [];
    const content = rawContent.map((item) => ({ ...item }));
    return {
      ...result,
      content: content.length ? content : [{ type: "text", text: `(${peer.name} returned no content)` }],
      ...(result.structuredContent ? { structuredContent: result.structuredContent as { [key: string]: unknown } } : {}),
      ...(result.isError ? { isError: true } : {}),
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Could not reach peer agent "${peer.name}": ${(err as Error).message}` }],
      isError: true,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Poll a wallet job through the peer's advertised MCP receipt tool. Profiled
 * channel credentials are MCP-only and must never be presented to generic REST.
 */
export async function pollPeerMcpJob(
  peer: PeerConfig,
  jobId: string,
  intervalMs = 1_000,
  timeoutMs = 180_000,
): Promise<PeerMcpJobPollResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = typedPeerJobTerminal(
      await callPeerTool(peer, "get_task_result", { ticket_id: jobId }),
      jobId,
    );
    if (terminal) return terminal;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: "timeout" };
}

interface VerifiedStoreReceipt {
  evidenceRef: string;
  evidenceUrl?: string;
  pagesTouched?: string[];
  pageUrls?: string[];
  revision?: StoreResult["revision"];
  urls?: string[];
  commitSha?: string;
  githubUrls?: string[];
  filing: StoreResult["filing"];
}

function verifiedStoreReceipt(
  completed: PeerMcpJobPollResult,
): VerifiedStoreReceipt | null {
  if (completed.status !== "done" || completed.kind !== "store") return null;
  const receipt = objectRecord(completed.result);
  if (!receipt || durableStoreReceiptError(receipt)) return null;
  const rawRevision = objectRecord(receipt?.revision);
  const revision = rawRevision
    && (rawRevision.provider === "github" || rawRevision.provider === "google_drive")
    && typeof rawRevision.id === "string"
    && rawRevision.id.trim()
    && typeof rawRevision.committedAt === "string"
    && !Number.isNaN(Date.parse(rawRevision.committedAt))
    && Array.isArray(rawRevision.urls)
    && rawRevision.urls.every((value) => typeof value === "string")
      ? rawRevision as unknown as NonNullable<StoreResult["revision"]>
      : null;
  const commitSha = typeof receipt?.commitSha === "string" ? receipt.commitSha : undefined;
  if (
    typeof receipt?.evidenceRef !== "string"
    || !receipt.evidenceRef.trim()
    || (receipt.urls !== undefined && !Array.isArray(receipt.urls))
    || (receipt.githubUrls !== undefined && !Array.isArray(receipt.githubUrls))
  ) return null;
  const filing = ["filed", "uncertain", "inbox", "pending"].includes(String(receipt.filing))
    ? receipt.filing as StoreResult["filing"]
    : typeof receipt.question === "string"
      ? "inbox"
      : "filed";
  return {
    evidenceRef: receipt.evidenceRef,
    ...(typeof receipt.evidenceUrl === "string" ? { evidenceUrl: receipt.evidenceUrl } : {}),
    ...(Array.isArray(receipt.pagesTouched) ? { pagesTouched: receipt.pagesTouched.filter((value): value is string => typeof value === "string") } : {}),
    ...(Array.isArray(receipt.pageUrls) ? { pageUrls: receipt.pageUrls.filter((value): value is string => typeof value === "string") } : {}),
    ...(revision ? { revision } : {}),
    ...(Array.isArray(receipt.urls) ? { urls: receipt.urls.filter((value): value is string => typeof value === "string") } : {}),
    ...(commitSha !== undefined ? { commitSha } : {}),
    ...(Array.isArray(receipt.githubUrls) ? { githubUrls: receipt.githubUrls.filter((value): value is string => typeof value === "string") } : {}),
    filing,
  };
}

/** Call a peer tool with full structured arguments, returning readable text for the chat loop. */
export async function callPeerWithArgs(
  peer: PeerConfig,
  mcpTool: string,
  args: Record<string, unknown>,
  options: { preserveFullResult?: boolean } = {},
): Promise<string> {
  const result = await callPeerTool(peer, mcpTool, args);
  const text = extractText(result);
  if (peer.wallet && mcpTool === "store_memory" && !result.isError) {
    const queued = objectRecord(result.structuredContent);
    const queuedJobId = queued?.ticket_id ?? queued?.jobId;
    const jobId = typeof queuedJobId === "string" ? queuedJobId : null;
    if (jobId) {
      const completed = await pollPeerMcpJob(peer, jobId, 1_000, 180_000);
      const receipt = verifiedStoreReceipt(completed);
      if (receipt) {
        const message = receipt.filing === "uncertain"
          ? `Saved — filed to ${receipt.pagesTouched?.[0] ?? "the selected page"} with an open filing question logged in the page (review anytime).`
          : receipt.filing === "inbox"
            ? "Saved — filed to Inbox; the filing question is logged in the note."
            : receipt.filing === "pending"
              ? "Filing pending."
              : "Saved.";
        return JSON.stringify({
          status: "done",
          message,
          evidenceRef: receipt.evidenceRef,
          ...(receipt.evidenceUrl ? { evidenceUrl: receipt.evidenceUrl } : {}),
          ...(receipt.pagesTouched ? { pagesTouched: receipt.pagesTouched } : {}),
          ...(receipt.pageUrls ? { pageUrls: receipt.pageUrls } : {}),
          ...(receipt.revision ? { revision: receipt.revision } : {}),
          ...(receipt.urls ? { urls: receipt.urls } : {}),
          ...(receipt.commitSha ? { commitSha: receipt.commitSha } : {}),
          ...(receipt.githubUrls ? { githubUrls: receipt.githubUrls } : {}),
          filing: receipt.filing,
        });
      }
      if (completed.status === "done") return `Zenod filing returned an invalid terminal receipt for job ${jobId}.`;
      if (completed.status === "error") return `Zenod filing failed: ${completed.error ?? "unknown error"}`;
      return `Zenod filing receipt timed out for job ${jobId}.`;
    }
  }
  const structured = objectRecord(result.structuredContent);
  if (
    !result.isError
    && structured?.type === "answer_content"
    && typeof structured.text === "string"
  ) {
    return JSON.stringify({
      type: "answer_content",
      text: structured.text,
      ...(Array.isArray(structured.sources) ? { sources: structured.sources } : {}),
    });
  }
  if (options.preserveFullResult) return JSON.stringify(result);
  if (result.structuredContent || result.content.some((item) => item.type !== "text")) {
    return JSON.stringify(result);
  }
  if (text) return text;
  if (result.structuredContent) return JSON.stringify(result.structuredContent);
  return `(${peer.name} returned no text)`;
}
