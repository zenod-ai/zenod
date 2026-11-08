import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { createEngine, SqliteStateStore, VaultRepo, type BrainEngine, type BrainLlm, type StoreInput } from "zenod";

const transcribeAudio = vi.hoisted(() => vi.fn());
vi.mock("../src/transcribe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/transcribe.js")>()),
  transcribeAudio,
}));

import { SqliteCredentialVault } from "../src/credentialVault.js";
import { projectCapture } from "../src/recentSaves.js";
import type { Runtime } from "../src/runtime.js";
import type { Settings } from "../src/settings.js";
import { grantScope, mountSubscriberApi } from "../src/subscriberApi.js";
import { mountSubscriberRoutes } from "../src/subscriberRoutes.js";
import { SubscriberDispatcher, SubscriberStore } from "../src/subscribers.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { forwardIdempotencyKey } from "../src/voiceNoteForward.js";

// EPIC-21 V1: the ingest door for voice notes recorded in other apps, end to end over HTTP: Sign in with Zenod with
// voice_notes.write, the narrow MCP server, the media seam (archive, supplied or Zenod transcript, Log entry, filing).

const REDIRECT = "https://team.alpha9.io/api/connections/zenod/callback";
const OTHER_REDIRECT = "https://notes.example.com/callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const AUDIO = Buffer.from("OggS demo voice note bytes, invented for the test");
const TRANSCRIPT = "Note for the boat repair. The yard in Porthaven quoted 940 euros for new antifouling.";

const dirs: string[] = [];
const servers: ServerType[] = [];
const queues: TaskJobQueue[] = [];
afterEach(async () => {
  transcribeAudio.mockReset();
  await Promise.all(queues.splice(0).map((queue) => queue.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function harness(options: { engine?: BrainEngine } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "zenod-voice-forward-"));
  dirs.push(dir);
  const tenantDir = join(dir, "jordi");
  mkdirSync(tenantDir, { recursive: true });
  transcribeAudio.mockImplementation(async () => ({ success: true, transcript: "Zenod's own transcript of the note.", provider: "stub-whisper" }));
  const settings = {
    get: (key: string) => ({ artifact_archive_provider: "local", artifact_archive_local_dir: join(dir, "archive") })[key] ?? null,
    whisperModel: () => "large-v3-turbo",
    openrouterApiKey: () => null,
    openrouterUser: () => undefined,
    openrouterTranscriptionModel: () => "openai/whisper-large-v3-turbo",
    longTranscriptionProvider: () => "local",
    useOpenAiForLongTranscription: () => false,
    transcriptionUsageSink: () => () => undefined,
  } as unknown as Settings;

  // A memory that keeps every Log entry and finds it by its words (what search does over the vault).
  const log: StoreInput[] = [];
  let seq = 0;
  const engine = options.engine ?? {
    captureEvidence: vi.fn(async (input: StoreInput) => {
      log.push(input);
      return { evidenceRef: `Log/2026-11-08.md#^e-fwd${++seq}`, pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "pending" as const };
    }),
    enrichEvidence: vi.fn(async (input: StoreInput & { evidenceRef: string }) => ({
      evidenceRef: input.evidenceRef, pagesTouched: ["Projects/Boat repair.md"], commitSha: "b".repeat(40), githubUrls: [], filing: "filed" as const,
    })),
  } as unknown as BrainEngine;
  const search = (words: string) => log.filter((entry) => entry.content.toLowerCase().includes(words.toLowerCase()));

  const vault = new SqliteCredentialVault({ dataDir: tenantDir, tenantId: "jordi", masterKey: "2".repeat(64) });
  const subscribers = new SubscriberStore(join(tenantDir, "subscribers.sqlite"), vault);
  const deliveries: Array<{ url: string; body: string }> = [];
  const dispatcher = new SubscriberDispatcher({
    tenantId: "jordi", store: subscribers, policy: { privateOrigins: new Set(), privateTenants: new Set() }, publicBaseUrl: "https://cloud.zenod.dev",
    fetch: (async (url: string, init: RequestInit) => (deliveries.push({ url, body: String(init.body) }), new Response(null, { status: 200 }))) as never,
    lookup: async () => ["93.184.216.34"], retryMs: [1, 1], log: () => {},
  });
  const store = new TaskJobStore(join(tenantDir, "tasks.sqlite"));
  let allowanceBlock: { message: string; resetsAt: string } | null = null;
  const queue = new TaskJobQueue(store, async () => engine, settings, undefined, () => null, dispatcher.onEntryStored);
  queues.push(queue);
  const runtime = {
    tenantId: "jordi", subscribers, subscriberDispatcher: dispatcher, taskJobQueue: queue, taskJobStore: store,
    getEngine: async () => engine, aiAllowanceBlock: () => allowanceBlock,
  } as unknown as Runtime;

  const audioFetch = vi.fn(async () => new Response(AUDIO, { status: 200, headers: { "content-type": "audio/ogg" } }));
  const app = new Hono();
  mountSubscriberApi(app as never, {
    enabled: () => true,
    dataDir: dir,
    getClient: (clientId) => clientId === "zc_team" ? { clientId, clientName: "Epic Team", redirectUris: [REDIRECT] }
      : clientId === "zc_other" ? { clientId, clientName: "Other Notes", redirectUris: [OTHER_REDIRECT] } : null,
    identity: () => ({ userId: "u1", name: "Jordi Montes", email: "jordi@alpha9.io", provider: "google", tenantId: "jordi" }),
    signInUrl: (returnTo) => `/auth/mcp/signin?return_to=${encodeURIComponent(returnTo)}`,
    runtimeForTenant: (tenantId) => tenantId === "jordi" ? runtime : null,
    lookup: async (hostname) => hostname === "private.example" ? ["10.0.0.5"] : ["93.184.216.34"],
    fetch: audioFetch as never,
  });
  mountSubscriberRoutes(app as never, runtime);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function signIn(scope: string, clientId = "zc_team", redirect = REDIRECT): Promise<string> {
    const url = new URL("/oauth/authorize", base);
    for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: redirect, state: "st8", code_challenge: CHALLENGE, code_challenge_method: "S256", scope })) url.searchParams.set(k, v);
    const html = await (await fetch(url)).text();
    const form = new URLSearchParams();
    for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) form.set(match[1]!, match[2]!.replace(/&amp;/g, "&"));
    form.set("decision", "approve");
    const res = await fetch(`${base}/oauth/subscribers/decision`, { method: "POST", body: form, headers: { origin: base }, redirect: "manual" });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const token = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: VERIFIER, client_id: clientId }) });
    return String(((await token.json()) as { access_token: string }).access_token);
  }

  async function connect(token: string): Promise<Client> {
    const client = new Client({ name: "epicteam-chat-forwarder", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/subscribers/v1/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
  }

  async function settle(jobId: string): Promise<void> {
    for (let i = 0; i < 1500; i += 1) {
      const job = store.get(jobId);
      const enrichment = (job?.result as { digest?: { enrichmentJobId?: string } } | null)?.digest?.enrichmentJobId;
      if (job?.status === "error" || (job?.status === "done" && (!enrichment || store.get(enrichment)?.status === "done"))) return;
      await sleep(10);
    }
  }

  return { base, app, store, queue, runtime, engine, log, search, subscribers, deliveries, audioFetch, signIn, connect, settle, block: (b: typeof allowanceBlock) => { allowanceBlock = b; } };
}

const structured = (result: unknown) => (result as { structuredContent: Record<string, unknown> }).structuredContent;

describe("voice_notes.write: the forwarding grant", () => {
  it("offers the subscriber pair, write alone, or all three, and nothing else", () => {
    expect(grantScope("voice_notes.read voice_notes.subscribe")).toBe("voice_notes.read voice_notes.subscribe");
    expect(grantScope("voice_notes.write")).toBe("voice_notes.write");
    expect(grantScope("voice_notes.write voice_notes.subscribe voice_notes.read")).toBe("voice_notes.read voice_notes.subscribe voice_notes.write");
    expect(grantScope("voice_notes.read")).toBeNull();
    expect(grantScope("voice_notes.write mcp")).toBeNull();
    expect(grantScope("")).toBeNull();
  });

  it("asks the person in plain words and gives a token that can only forward", async () => {
    const h = await harness();
    const url = new URL("/oauth/authorize", h.base);
    for (const [k, v] of Object.entries({ client_id: "zc_team", redirect_uri: REDIRECT, state: "s", code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "voice_notes.write" })) url.searchParams.set(k, v);
    const html = await (await fetch(url)).text();
    for (const text of ["Epic Team wants to send its voice notes to your Zenod", "Adding voice notes you record in it to your Zenod, tagged with its name", "Reading anything in your Zenod", "Any right to change or delete in your Zenod", "scope: voice_notes.write"]) expect(html).toContain(text);

    const token = await h.signIn("voice_notes.write");
    const me = await fetch(`${h.base}/api/subscribers/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    expect((await me.json()) as Record<string, unknown>).toMatchObject({ scope: "voice_notes.write" });
    // It cannot read notes or subscribe...
    expect((await fetch(`${h.base}/api/subscribers/v1/notes`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    // ...and a subscriber-only token cannot forward.
    const reader = await h.signIn("voice_notes.read voice_notes.subscribe");
    const denied = await fetch(`${h.base}/api/subscribers/v1/mcp`, { method: "POST", headers: { authorization: `Bearer ${reader}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(denied.status).toBe(403);
    expect((await fetch(`${h.base}/api/subscribers/v1/mcp`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("is listed for the person apart from subscribers, and removing it stops the token at once", async () => {
    const h = await harness();
    const token = await h.signIn("voice_notes.write");
    const listed = (await (await fetch(`${h.base}/api/subscribers`)).json()) as { forwarders: Array<{ grant_id: string; name: string }> };
    expect(listed.forwarders).toEqual([expect.objectContaining({ name: "Epic Team", scope: "voice_notes.write" })]);
    expect((await fetch(`${h.base}/api/subscribers/forwarders/${listed.forwarders[0]!.grant_id}`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${h.base}/api/subscribers/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe("ingest_voice_note", () => {
  it("answers a bare JSON-RPC tools/call with no MCP SDK and no initialize (the curl example)", async () => {
    const h = await harness();
    const token = await h.signIn("voice_notes.write");
    const res = await fetch(`${h.base}/api/subscribers/v1/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_curl", audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg", transcript: "Plain curl." } } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { structuredContent: Record<string, unknown> } };
    expect(body.result.structuredContent).toMatchObject({ status: "queued", duplicate: false, transcript: "supplied" });
    await h.settle(String(body.result.structuredContent.jobId));
  });

  it("lists just the forwarding tools", async () => {
    const h = await harness();
    const client = await h.connect(await h.signIn("voice_notes.write"));
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["get_voice_note_ingest", "ingest_voice_note"]);
    await client.close();
  });

  it("files a note with its transcript once, never transcribes it, tags the app, and a repeat forward is the same note", async () => {
    const h = await harness();
    const client = await h.connect(await h.signIn("voice_notes.write"));
    const args = {
      sourceApp: "EpicTeam Chat", idempotencyKey: "vn_demo0001", audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg",
      transcript: TRANSCRIPT, transcriptModel: "gpt-4o-mini-transcribe", recordedAt: "2026-11-08T18:53:00Z", durationSeconds: 14.8,
    };
    const first = structured(await client.callTool({ name: "ingest_voice_note", arguments: args }));
    expect(first).toMatchObject({ status: "queued", duplicate: false, sourceApp: "EpicTeam Chat", transcript: "supplied" });
    await h.settle(String(first.jobId));

    const again = structured(await client.callTool({ name: "ingest_voice_note", arguments: args }));
    expect(again).toMatchObject({ jobId: first.jobId, duplicate: true, status: "done" });

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(h.engine.captureEvidence).toHaveBeenCalledTimes(1);
    expect(h.engine.enrichEvidence).toHaveBeenCalledTimes(1);
    const entry = h.log[0]!;
    expect(entry).toMatchObject({ contentType: "voice_note", source: "mcp", capturedAt: "2026-11-08T18:53:00Z", verbatim: true });
    for (const line of ["Voice note \"epicteam-chat-voice-note-2026-11-08T18-53-00Z.ogg\" ingested through Zenod media seam.", "Source: EpicTeam Chat voice note", "Source app: EpicTeam Chat", "Transcribed by gpt-4o-mini-transcribe (transcribed by EpicTeam Chat).", TRANSCRIPT]) {
      expect(entry.content).toContain(line);
    }
    expect(h.search("Porthaven")).toHaveLength(1);

    const receipt = structured(await client.callTool({ name: "get_voice_note_ingest", arguments: { jobId: first.jobId } }));
    expect(receipt).toMatchObject({
      status: "done", filing: "saved", sourceApp: "EpicTeam Chat", transcript: "supplied",
      transcribedBy: "gpt-4o-mini-transcribe (transcribed by EpicTeam Chat)", evidenceRef: "Log/2026-11-08.md#^e-fwd1",
      pagesTouched: ["Projects/Boat repair.md"],
    });
    const job = h.store.get(String(first.jobId))!;
    expect(job.idempotencyKey).toBe(forwardIdempotencyKey("jordi", "zc_team", "vn_demo0001"));
    expect(projectCapture(h.store, job)).toMatchObject({ channelLabel: "EpicTeam Chat voice", status: "saved", notePath: "Projects/Boat repair.md" });
    await client.close();
  });

  it("transcribes a note without a transcript exactly once", async () => {
    const h = await harness();
    const client = await h.connect(await h.signIn("voice_notes.write"));
    const result = structured(await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_demo0002", audioBase64: AUDIO.toString("base64"), mimeType: "audio/webm;codecs=opus" } }));
    expect(result).toMatchObject({ transcript: "zenod", duplicate: false });
    await h.settle(String(result.jobId));
    await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_demo0002", audioBase64: AUDIO.toString("base64"), mimeType: "audio/webm" } });
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveLength(1);
    expect(h.log[0]!.content).toContain("Transcribed by stub-whisper.");
    expect(h.log[0]!.content).toContain("Zenod's own transcript of the note.");
    expect(structured(await client.callTool({ name: "get_voice_note_ingest", arguments: { jobId: result.jobId } }))).toMatchObject({ transcript: "zenod", transcribedBy: "stub-whisper" });
    await client.close();
  });

  it("fetches audio from a public HTTPS link, refuses private addresses, and checks its input", async () => {
    const h = await harness();
    const client = await h.connect(await h.signIn("voice_notes.write"));
    const ok = structured(await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_url", audioUrl: "https://files.example.com/vn_url.ogg", transcript: "From a link.", transcriptModel: "gpt-4o-mini-transcribe" } }));
    expect(ok).toMatchObject({ duplicate: false, transcript: "supplied" });
    expect(h.audioFetch).toHaveBeenCalledWith(new URL("https://files.example.com/vn_url.ogg"), expect.objectContaining({ redirect: "error" }));
    const call = async (args: Record<string, unknown>) => structured(await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "k", ...args } }));
    expect(await call({ audioUrl: "https://private.example/a.ogg" })).toMatchObject({ code: "audio_url_not_allowed" });
    expect(await call({ audioUrl: "http://files.example.com/a.ogg" })).toMatchObject({ code: "audio_url_not_allowed" });
    expect(await call({})).toMatchObject({ code: "invalid_input" });
    expect(await call({ audioBase64: AUDIO.toString("base64") })).toMatchObject({ code: "invalid_input" });
    expect(await call({ audioBase64: AUDIO.toString("base64"), mimeType: "video/mp4" })).toMatchObject({ code: "unsupported_audio" });
    h.block({ message: "capped", resetsAt: "2026-12-01T00:00:00Z" });
    expect(await call({ audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg" })).toMatchObject({ code: "ai_allowance_exhausted" });
    await client.close();
  });

  it("keeps apps apart: another app's job is not found, and the same key from two apps is two notes", async () => {
    const h = await harness();
    const team = await h.connect(await h.signIn("voice_notes.write"));
    const other = await h.connect(await h.signIn("voice_notes.write", "zc_other", OTHER_REDIRECT));
    const args = { idempotencyKey: "note-1", audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg", transcript: "Same key, two apps." };
    const a = structured(await team.callTool({ name: "ingest_voice_note", arguments: { ...args, sourceApp: "EpicTeam Chat" } }));
    const b = structured(await other.callTool({ name: "ingest_voice_note", arguments: { ...args, sourceApp: "Other Notes" } }));
    expect(a.jobId).not.toBe(b.jobId);
    expect(structured(await other.callTool({ name: "get_voice_note_ingest", arguments: { jobId: a.jobId } }))).toMatchObject({ code: "not_found" });
    await team.close();
    await other.close();
  });

  it("does not announce a forwarded note back to the app that sent it, only to other subscribers", async () => {
    const h = await harness();
    const both = await h.signIn("voice_notes.read voice_notes.subscribe voice_notes.write");
    const created = await fetch(`${h.base}/api/subscribers/v1/subscriptions`, { method: "POST", headers: { authorization: `Bearer ${both}`, "content-type": "application/json" }, body: JSON.stringify({ event: "voice_note.captured", url: "https://team.alpha9.io/hooks/zenod" }) });
    expect(created.status).toBe(201);
    const watcher = await h.signIn("voice_notes.read voice_notes.subscribe", "zc_other", OTHER_REDIRECT);
    await fetch(`${h.base}/api/subscribers/v1/subscriptions`, { method: "POST", headers: { authorization: `Bearer ${watcher}`, "content-type": "application/json" }, body: JSON.stringify({ event: "voice_note.captured", url: "https://notes.example.com/hooks/zenod" }) });
    const client = await h.connect(both);
    const result = structured(await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_echo", audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg", transcript: "No echo, please." } }));
    await h.settle(String(result.jobId));
    for (let i = 0; i < 50 && h.deliveries.length === 0; i += 1) await sleep(10);
    expect(h.deliveries.map((d) => new URL(d.url).host)).toEqual(["notes.example.com"]);
    await client.close();
  });
});

describe("demo on the real memory engine (evidence for EPIC-21 V1)", () => {
  it("a forwarded note lands once in a real vault, with no transcription call, filed and searchable; without a transcript it is transcribed once", async () => {
    const root = await mkdtemp(join(tmpdir(), "zenod-voice-forward-demo-"));
    dirs.push(root);
    const bare = join(root, "origin.git");
    await mkdir(bare);
    await simpleGit(bare).init(true, { "--initial-branch": "main" });
    const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
    await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
    await repo.commitAndPublish("demo vault (made up)");
    // The filing model is a recorded answer, so the demo spends nothing; every call is counted.
    const classify = vi.fn(async (request: { content?: string }) => {
      const quote = String(request.content ?? "").includes("Porthaven") ? "The yard in Porthaven quoted 940 euros for new antifouling." : "Zenod's own transcript of the note.";
      return { confidence: 0.95, summary: "boat repair quote", tags: [], pages: [], topics: [{
        topic: "Boat repair", summary: "Boat repair quote", confidence: 0.95, disposition: "integrate_page" as const,
        evidenceQuotes: [quote], pages: [{ path: "Projects/Boat repair.md", title: "Boat repair", action: "create" as const }],
      }] };
    });
    const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({
      kind: "add", ideaIds: [idea.id], sourceIds: request.addCandidates.filter((c: any) => c.ideaIds.includes(idea.id)).map((c: any) => c.id),
      sourceQuote: request.sources.find((source: any) => source.id === idea.sourceIds[0]).text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null,
    })));
    const state = new SqliteStateStore(join(root, "state.sqlite"));
    const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
    const h = await harness({ engine });
    const client = await h.connect(await h.signIn("voice_notes.write"));
    const withTranscript = {
      sourceApp: "EpicTeam Chat", idempotencyKey: "vn_demo_boat", audioBase64: AUDIO.toString("base64"), mimeType: "audio/ogg",
      transcript: TRANSCRIPT + " Ask Marta to compare it with the Westbay quote before Friday.", transcriptModel: "gpt-4o-mini-transcribe", recordedAt: "2026-11-08T18:53:00Z", durationSeconds: 14.8,
    };
    const first = structured(await client.callTool({ name: "ingest_voice_note", arguments: withTranscript }));
    await h.settle(String(first.jobId));
    const repeat = structured(await client.callTool({ name: "ingest_voice_note", arguments: withTranscript }));
    const receipt = structured(await client.callTool({ name: "get_voice_note_ingest", arguments: { jobId: first.jobId } }));
    const afterFirst = { transcription: transcribeAudio.mock.calls.length, classify: classify.mock.calls.length, reconcile: reconcile.mock.calls.length };

    const bare2 = structured(await client.callTool({ name: "ingest_voice_note", arguments: { sourceApp: "EpicTeam Chat", idempotencyKey: "vn_demo_plain", audioBase64: AUDIO.toString("base64"), mimeType: "audio/webm" } }));
    await h.settle(String(bare2.jobId));
    const receipt2 = structured(await client.callTool({ name: "get_voice_note_ingest", arguments: { jobId: bare2.jobId } }));
    const afterSecond = { transcription: transcribeAudio.mock.calls.length, classify: classify.mock.calls.length, reconcile: reconcile.mock.calls.length };

    const evidenceRef = String(receipt.evidenceRef);
    const logFile = await readFile(join(repo.path, evidenceRef.split("#")[0]!), "utf8");
    const hits = await engine.search("Porthaven antifouling");
    const entries = await engine.searchEntries({ contentType: "voice_note", limit: null });

    expect(receipt).toMatchObject({ status: "done", transcript: "supplied", transcribedBy: "gpt-4o-mini-transcribe (transcribed by EpicTeam Chat)", pagesTouched: expect.arrayContaining(["Projects/Boat repair.md"]) });
    expect(repeat).toMatchObject({ jobId: first.jobId, duplicate: true });
    expect(afterFirst.transcription).toBe(0);
    expect(afterSecond.transcription).toBe(1);
    expect(receipt2).toMatchObject({ status: "done", transcript: "zenod", transcribedBy: "stub-whisper" });
    expect(logFile.match(/Porthaven/g)?.length).toBe(1);
    expect(logFile).toContain("Source app: EpicTeam Chat");
    expect(hits.some((hit) => hit.path.startsWith("Log/") || hit.path === "Projects/Boat repair.md")).toBe(true);
    expect(entries.filter((entry) => entry.content.includes("Porthaven"))).toHaveLength(1);

    if (process.env.E21_DEMO_OUT) {
      await writeFile(process.env.E21_DEMO_OUT, JSON.stringify({
        first, repeat, receipt, afterFirst, bare: bare2, receipt2, afterSecond,
        voiceNoteEntries: entries.map((entry) => ({ evidenceRef: entry.evidenceRef, source: entry.source, contentType: entry.contentType, capturedAt: entry.capturedAt, porthaven: entry.content.includes("Porthaven") })),
        searchTop: hits.slice(0, 5).map((hit) => hit.path),
        boatPage: await readFile(join(repo.path, "Projects/Boat repair.md"), "utf8").catch(() => null),
        logExcerpt: logFile.slice(Math.max(0, logFile.indexOf("Voice note \"epicteam") - 200), logFile.indexOf("Voice note \"epicteam") + 1400),
      }, null, 2));
    }
    await client.close();
    await h.queue.close();
    state.close();
  }, 60_000);
});
