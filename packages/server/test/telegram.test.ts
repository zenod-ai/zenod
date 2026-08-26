import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { Runtime } from "../src/runtime.js";
import { TelegramGateway, chunkText, type TelegramManagedInbound } from "../src/telegramGateway.js";
import { CustomerManagedAiAdmissionQueue } from "../src/customerManagedAiAdmission.js";
import {
  normalizeAllowedUsers,
  normalizeTelegramId,
  parseStoredAllowedUsers,
  userIsAllowed,
} from "../src/telegramConfig.js";

interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

/**
 * Fakes the Telegram Bot API over fetch. Delivers `message` exactly once via
 * getUpdates, then returns empty batches so the poll loop idles. `richOk`
 * toggles whether sendRichMessage succeeds (false → forces the plain fallback).
 */
function fakeBotApi(message: Record<string, unknown> | null, options: { richOk?: boolean } = {}) {
  const calls: ApiCall[] = [];
  let delivered = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // The file-download endpoint (/file/bot<token>/<path>) returns raw bytes, not
    // the JSON envelope — serve fake audio so downloadFile() can read a buffer.
    if (url.includes("/file/bot")) {
      calls.push({ method: "download", body: {} });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }
    const method = url.split("/").pop() ?? "";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, body });
    const reply = (result: unknown, ok = true) =>
      new Response(JSON.stringify({ ok, result, ...(ok ? {} : { description: "forced failure" }) }), {
        status: ok ? 200 : 400,
        headers: { "content-type": "application/json" },
      });

    if (method === "getMe") return reply({ id: 42, is_bot: true, username: "zenod_test_bot" });
    if (method === "getUpdates") {
      if (body.offset === -1) return reply([]); // primeOffset
      if (message && !delivered) {
        delivered = true;
        return reply([{ update_id: 100, message }]);
      }
      // Simulate long-poll: don't return an empty batch instantly, or the loop
      // would spin hot (real Telegram holds the request open ~50s).
      await new Promise((resolve) => setTimeout(resolve, 25));
      return reply([]);
    }
    if (method === "getFile") return reply({ file_path: "voice/file_1.oga" });
    if (method === "sendRichMessage") return reply({ message_id: 1 }, options.richOk ?? true);
    return reply({ message_id: 1 }); // sendMessage, sendChatAction
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function fakeAcknowledgedBotApi(message: Record<string, unknown>) {
  const calls: ApiCall[] = [];
  let acknowledged = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/file/bot")) {
      calls.push({ method: "download", body: {} });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }
    const method = url.split("/").pop() ?? "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, body });
    const reply = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    if (method === "getMe") return reply({ id: 42, is_bot: true, username: "zenod_test_bot" });
    if (method === "getUpdates") {
      const offset = Number(body.offset ?? 0);
      if (offset > 100) acknowledged = true;
      if (!acknowledged) return reply([{ update_id: 100, message }]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return reply([]);
    }
    if (method === "getFile") return reply({ file_path: "voice/file_1.oga" });
    return reply({ message_id: 1 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, acknowledged: () => acknowledged };
}

function fakeEngine(seen: string[]): BrainEngine {
  return {
    async handleTasking(input) {
      seen.push(`${input.surface}:${input.conversationKey}:${input.text}`);
      return { text: `| Task | Status |\n|---|---|\n| ${input.text} | done |`, actions: [] };
    },
    async chat() {
      return { text: "", sources: [] };
    },
    async store() {
      throw new Error("unused");
    },
    async ask() {
      throw new Error("unused");
    },
    async search() {
      return [];
    },
    async get() {
      throw new Error("unused");
    },
    async lint() {
      return { ok: true, errors: [], checkedFiles: 0 };
    },
    async work() {
      return { mode: "proposal", text: "", committed: false };
    },
    async digestBacklog() {
      return { candidates: [], written: [], skipped: [], source_refs: [] };
    },
  } as unknown as BrainEngine;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for async work");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function tgMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: 7,
    date: 1700000000,
    from: { id: 555, first_name: "Tester", username: "tester" },
    chat: { id: 555, type: "private" },
    text: "summarize the deploy",
    ...overrides,
  };
}

describe("telegramConfig", () => {
  it("normalizes ids and parses allowlists of handles and numeric ids", () => {
    expect(normalizeTelegramId(" 123 ")).toBe("123");
    expect(normalizeTelegramId("-100200")).toBe("-100200");
    // Allowlist entries may be @handles or numeric ids; handles lowercase + strip @.
    expect(normalizeAllowedUsers("@AlfaBlok, 456\n@bob")).toEqual(["alfablok", "456", "bob"]);
    expect(parseStoredAllowedUsers(JSON.stringify(["@Alice", "2"]))).toEqual(["alice", "2"]);
  });

  it("enforces the allowlist by handle or id unless acceptAll", () => {
    const list = { acceptAll: false, allowedUsers: ["alfablok", "123"] };
    expect(userIsAllowed({ username: "alfablok" }, list)).toBe(true);
    expect(userIsAllowed({ username: "AlfaBlok" }, list)).toBe(true); // case-insensitive
    expect(userIsAllowed({ id: 123 }, list)).toBe(true);
    expect(userIsAllowed({ id: 999, username: "stranger" }, list)).toBe(false);
    expect(userIsAllowed({ id: 999 }, { acceptAll: true, allowedUsers: [] })).toBe(true);
  });
});

describe("chunkText", () => {
  it("keeps short text whole and splits long text under the limit", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
    const chunks = chunkText("a".repeat(250), 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join("")).toBe("a".repeat(250));
  });
});

describe("TelegramGateway", () => {
  it("sanitizes hostile failures at the whole ported gateway boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-ported-safe-errors-"));
    const runtime = new Runtime(dir);
    const hostile = "https://internal.example/secret?token=bearer-123 Ring Phylax MCP tool stack";
    const { fetchImpl, calls } = fakeBotApi(tgMessage());
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const gateway = new TelegramGateway({
      settings: runtime.settings,
      getEngine: async () => fakeEngine([]),
      fetchImpl,
      portedInboundHandler: async () => {
        throw new Error(hostile);
      },
    });
    try {
      await gateway.start();
      await waitFor(() => calls.some((call) => call.method === "sendRichMessage"));
      const rich = calls.find((call) => call.method === "sendRichMessage")?.body.rich_message as { markdown?: string };
      const customerText = String(rich.markdown);
      expect(customerText).toBe("⚠️ Zenod could not process that message. Please try again.");
      expect(customerText).not.toMatch(/internal\.example|bearer-123|Ring|Phylax|MCP|tool|stack/i);
    } finally {
      consoleError.mockRestore();
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent starts into one Telegram polling loop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(null);
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    try {
      await Promise.all([gateway.start(), gateway.start()]);
      expect(calls.filter((call) => call.method === "getMe")).toHaveLength(1);
      expect(calls.filter((call) => call.method === "getUpdates" && call.body.offset === -1)).toHaveLength(1);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows only one gateway object to poll a bot token at a time", async () => {
    const firstDir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const secondDir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const firstRuntime = new Runtime(firstDir);
    const secondRuntime = new Runtime(secondDir);
    const { fetchImpl, calls } = fakeBotApi(null);
    firstRuntime.settings.setTelegramSettings({ botToken: "SHARED:TOKEN", allowedUsers: ["555"], enabled: true });
    secondRuntime.settings.setTelegramSettings({ botToken: "SHARED:TOKEN", allowedUsers: ["555"], enabled: true });
    const owner = new TelegramGateway({ settings: firstRuntime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    const contender = new TelegramGateway({ settings: secondRuntime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    try {
      await owner.start();
      await contender.start();
      expect(owner.status().state).toBe("connected");
      expect(contender.status()).toMatchObject({
        state: "error",
        lastError: "Telegram polling is already owned by another gateway in this process.",
      });
      expect(calls.filter((call) => call.method === "getMe")).toHaveLength(1);

      await owner.close();
      await contender.start();
      expect(contender.status().state).toBe("connected");
      expect(calls.filter((call) => call.method === "getMe")).toHaveLength(2);
    } finally {
      await owner.close();
      await contender.close();
      firstRuntime.close();
      secondRuntime.close();
      await rm(firstDir, { recursive: true, force: true });
      await rm(secondDir, { recursive: true, force: true });
    }
  });

  it("requires the immutable numeric recipient and never falls back through a legacy allowlist handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(null);
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["@AlfaBlok", "555"], enabled: false });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    try {
      await expect(
        gateway.sendText("@AlfaBlok", "Phylax Telegram receipt pass."),
      ).rejects.toThrow("Telegram recipient and text are required");
      await expect(gateway.sendText("555", "Phylax Telegram receipt pass.")).resolves.toEqual({ sentMessageId: "1" });
      expect(calls.find((call) => call.method === "sendMessage")?.body).toMatchObject({
        chat_id: 555,
        text: "Phylax Telegram receipt pass.",
      });
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("projects the immutable numeric sender and keeps username as display-only ported metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-immutable-id-"));
    const runtime = new Runtime(dir);
    const { fetchImpl } = fakeBotApi(tgMessage());
    runtime.settings.setTelegramSettings({
      botToken: "TEST:TOKEN",
      allowedUsers: [],
      acceptAll: true,
      enabled: true,
    });
    const inbound: Array<{
      sender: string;
      username?: string | null;
      chatId: string;
    }> = [];
    const gateway = new TelegramGateway({
      settings: runtime.settings,
      getEngine: async () => fakeEngine([]),
      fetchImpl,
      portedInboundHandler: async (input) => {
        inbound.push({
          sender: input.sender,
          username: input.username,
          chatId: input.chatId,
        });
        return { replyText: "verified" };
      },
    });
    try {
      await gateway.start();
      await waitFor(() => inbound.length === 1);
      expect(inbound).toEqual([
        { sender: "555", username: "@tester", chatId: "555" },
      ]);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes an allowed message through handleTasking and replies with a rich message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const seen: string[] = [];
    const { fetchImpl, calls } = fakeBotApi(tgMessage());
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true, rich: true });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine(seen), fetchImpl });
    try {
      await gateway.start();
      await waitFor(() => calls.some((c) => c.method === "sendRichMessage"));
      expect(seen).toEqual(["telegram:555:summarize the deploy"]);
      const rich = calls.find((c) => c.method === "sendRichMessage")!;
      expect(rich.body.chat_id).toBe(555);
      const richMessage = rich.body.rich_message as { markdown?: string };
      expect(String(richMessage.markdown)).toContain("| Task | Status |");
      expect(gateway.status().botUsername).toBe("zenod_test_bot");
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["text", tgMessage(), false],
    ["audio", tgMessage({ text: undefined, voice: { file_id: "AUDIO123", file_unique_id: "audio-1", mime_type: "audio/ogg" } }), true],
    ["image", tgMessage({ text: undefined, photo: [{ file_id: "IMAGE123", width: 10, height: 10 }] }), true],
  ] as const)("admits Hosted Telegram %s raw evidence before advancing the update offset", async (kind, message, hasMedia) => {
    const dir = await mkdtemp(join(tmpdir(), `zenod-telegram-managed-${kind}-`));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(message);
    runtime.settings.setTelegramSettings({ botToken: `MANAGED:${kind}`, allowedUsers: ["555"], enabled: true });
    const admitted: Array<{ kind: string; updateId: string; media?: { dataBase64: string } }> = [];
    const gateway = new TelegramGateway({
      settings: runtime.settings,
      getEngine: async () => {
        throw new Error("paid engine must remain behind admission");
      },
      fetchImpl,
      managedInboundHandler: async (input) => { admitted.push(input); },
    });
    try {
      await gateway.start();
      await waitFor(() => admitted.length === 1 && calls.some((call) => call.method === "getUpdates" && call.body.offset === 101));
      expect(admitted[0]).toMatchObject({ kind, updateId: "100", chatId: "555", messageId: "7" });
      expect(Boolean(admitted[0]!.media?.dataBase64)).toBe(hasMedia);
      expect(calls.filter((call) => call.method === "getFile").length).toBe(hasMedia ? 1 : 0);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["group", tgMessage({ chat: { id: -1001, type: "group" } })],
    ["supergroup", tgMessage({ chat: { id: -1002, type: "supergroup" } })],
    ["channel", tgMessage({ chat: { id: -1003, type: "channel" } })],
    ["private id mismatch", tgMessage({ chat: { id: 999, type: "private" } })],
  ] as const)("denies Hosted managed Telegram input from %s scope", async (label, message) => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-managed-dm-boundary-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(message);
    runtime.settings.setTelegramSettings({
      botToken: `MANAGED:DENY:${label}`,
      allowedUsers: [],
      acceptAll: true,
      enabled: true,
    });
    const admitted = vi.fn();
    const gateway = new TelegramGateway({
      settings: runtime.settings,
      getEngine: async () => fakeEngine([]),
      fetchImpl,
      managedInboundHandler: admitted,
    });
    try {
      await gateway.start();
      await waitFor(() =>
        calls.some(
          (call) => call.method === "getUpdates" && call.body.offset === 101,
        ),
      );
      expect(admitted).not.toHaveBeenCalled();
      expect(
        calls.some((call) =>
          ["sendMessage", "sendRichMessage", "sendChatAction"].includes(
            call.method,
          ),
        ),
      ).toBe(false);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not advance the Hosted Telegram offset when durable admission fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-managed-admission-failure-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(tgMessage());
    runtime.settings.setTelegramSettings({ botToken: "MANAGED:FAIL", allowedUsers: ["555"], enabled: true });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const gateway = new TelegramGateway({
      settings: runtime.settings,
      getEngine: async () => { throw new Error("paid engine must not run"); },
      fetchImpl,
      pollErrorDelayMs: 1,
      managedInboundHandler: async () => { throw new Error("admission sqlite unavailable"); },
    });
    try {
      await gateway.start();
      await waitFor(() => calls.filter((call) => call.method === "getUpdates" && call.body.offset === 0).length >= 2);
      expect(calls.some((call) => call.method === "getUpdates" && call.body.offset === 101)).toBe(false);
    } finally {
      consoleError.mockRestore();
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["text", tgMessage()],
    ["audio", tgMessage({ text: undefined, voice: { file_id: "AUDIO123", file_unique_id: "audio-1", mime_type: "audio/ogg" } })],
    ["image", tgMessage({ text: undefined, photo: [{ file_id: "IMAGE123", width: 10, height: 10 }] })],
  ] as const)("recovers Hosted Telegram %s after admission SQLite failure and process restart", async (kind, message) => {
    const firstDir = await mkdtemp(join(tmpdir(), `zenod-telegram-restart-first-${kind}-`));
    const secondDir = await mkdtemp(join(tmpdir(), `zenod-telegram-restart-second-${kind}-`));
    const admissionDir = await mkdtemp(join(tmpdir(), `zenod-telegram-restart-admission-${kind}-`));
    const admissionPath = join(admissionDir, "admission.sqlite");
    const firstRuntime = new Runtime(firstDir);
    const secondRuntime = new Runtime(secondDir);
    const provider = fakeAcknowledgedBotApi(message);
    const token = `MANAGED:RESTART:${kind}`;
    firstRuntime.settings.setTelegramSettings({ botToken: token, allowedUsers: ["555"], enabled: true });
    secondRuntime.settings.setTelegramSettings({ botToken: token, allowedUsers: ["555"], enabled: true });
    const normal = { percentageUsed: 1, state: "normal" as const, resetsAt: "2026-09-01T00:00:00.000Z" };
    const processor = vi.fn(async () => ({
      value: { replyText: "stored once" },
      receipt: {
        state: "completed" as const,
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({ replyText: "stored once" }),
        completedAt: new Date().toISOString(),
      },
    }));
    const failedQueue = new CustomerManagedAiAdmissionQueue(
      admissionPath,
      Date.now,
      undefined,
      () => { throw new Error("admission sqlite unavailable"); },
    );
    const makeHandler = (queue: CustomerManagedAiAdmissionQueue) => async (input: TelegramManagedInbound) => {
      await queue.submit({
        tenantId: "tenant-42",
        idempotencyKey: `telegram:${input.chatId}:${input.messageId}`,
        kind: input.kind,
        method: "POST",
        path: "/internal/telegram",
        contentType: "application/json",
        raw: Buffer.from(JSON.stringify(input)),
      }, normal, processor);
    };
    const first = new TelegramGateway({
      settings: firstRuntime.settings,
      getEngine: async () => { throw new Error("paid engine must remain behind admission"); },
      fetchImpl: provider.fetchImpl,
      pollErrorDelayMs: 1_000,
      managedInboundHandler: makeHandler(failedQueue),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await first.start();
      await waitFor(() => provider.calls.some((call) => call.method === "getUpdates" && call.body.offset === 0));
      await first.close();
      expect(provider.acknowledged()).toBe(false);
      expect(provider.calls.some((call) => call.method === "getUpdates" && call.body.offset === -1)).toBe(false);
      expect(processor).not.toHaveBeenCalled();
      failedQueue.close();

      const restartedQueue = new CustomerManagedAiAdmissionQueue(admissionPath);
      const restarted = new TelegramGateway({
        settings: secondRuntime.settings,
        getEngine: async () => { throw new Error("paid engine must remain behind admission"); },
        fetchImpl: provider.fetchImpl,
        managedInboundHandler: makeHandler(restartedQueue),
      });
      try {
        await restarted.start();
        await waitFor(() => provider.acknowledged());
        expect(processor).toHaveBeenCalledTimes(1);
        const admitted = restartedQueue.getByIdempotencyKey("tenant-42", "telegram:555:7");
        expect(admitted).toMatchObject({ kind, status: "done", attempts: 1 });
        expect(Buffer.from(restartedQueue.raw(admitted!.id)!).toString("utf8"))
          .toContain(kind === "text" ? "summarize the deploy" : Buffer.from([1, 2, 3, 4]).toString("base64"));
      } finally {
        await restarted.close();
        restartedQueue.close();
      }
    } finally {
      consoleError.mockRestore();
      await first.close();
      try { failedQueue.close(); } catch {}
      firstRuntime.close();
      secondRuntime.close();
      await rm(firstDir, { recursive: true, force: true });
      await rm(secondDir, { recursive: true, force: true });
      await rm(admissionDir, { recursive: true, force: true });
    }
  });

  it("transcribes a voice note and routes the transcript through handleTasking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const seen: string[] = [];
    // A voice message has no text/caption — only a downloadable file reference.
    const voiceMessage = tgMessage({ text: undefined, voice: { file_id: "AUDIO123", file_unique_id: "u1", mime_type: "audio/ogg" } });
    const { fetchImpl, calls } = fakeBotApi(voiceMessage);
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true, rich: true });
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "file the launch notes";
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine(seen), fetchImpl });
    try {
      await gateway.start();
      await waitFor(() => seen.length > 0);
      expect(calls.some((c) => c.method === "getFile")).toBe(true);
      expect(calls.some((c) => c.method === "download")).toBe(true);
      expect(seen).toEqual(["telegram:555:file the launch notes"]);
    } finally {
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to plain sendMessage when sendRichMessage is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(tgMessage(), { richOk: false });
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true, rich: true });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    try {
      await gateway.start();
      await waitFor(() => calls.some((c) => c.method === "sendMessage"));
      expect(calls.some((c) => c.method === "sendRichMessage")).toBe(true);
      expect(calls.some((c) => c.method === "sendMessage")).toBe(true);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores messages from users not on the allowlist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const seen: string[] = [];
    const { fetchImpl, calls } = fakeBotApi(tgMessage({ from: { id: 999 }, chat: { id: 999, type: "private" } }));
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["555"], enabled: true, rich: true });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine(seen), fetchImpl });
    try {
      await gateway.start();
      // Give the loop time to fetch + process the (denied) update.
      await waitFor(() => calls.filter((c) => c.method === "getUpdates").length >= 2);
      expect(seen).toEqual([]);
      expect(calls.some((c) => c.method === "sendRichMessage" || c.method === "sendMessage")).toBe(false);
    } finally {
      await gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
