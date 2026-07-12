import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { Runtime } from "../src/runtime.js";
import { TelegramGateway, chunkText } from "../src/telegramGateway.js";
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

  it("delivers to a tenant-bound handle using the sole numeric owner allowlist entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-telegram-"));
    const runtime = new Runtime(dir);
    const { fetchImpl, calls } = fakeBotApi(null);
    runtime.settings.setTelegramSettings({ botToken: "TEST:TOKEN", allowedUsers: ["@AlfaBlok", "555"], enabled: false });
    const gateway = new TelegramGateway({ settings: runtime.settings, getEngine: async () => fakeEngine([]), fetchImpl });
    try {
      await expect(gateway.sendText("@AlfaBlok", "Phylax Telegram receipt pass.")).resolves.toEqual({ sentMessageId: "1" });
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
