import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrainEngine } from "zenod";
import type { Settings } from "./settings.js";
import { extractJobId, pollPeerJob } from "./pollPeerJob.js";
import { transcribeAudio, NO_SPEECH_MESSAGE } from "./transcribe.js";
import { normalizeTelegramId, userIsAllowed, type TelegramSettings } from "./telegramConfig.js";

export type TelegramConnectionState = "disabled" | "disconnected" | "connected" | "error";

export interface TelegramStatus {
  enabled: boolean;
  state: TelegramConnectionState;
  botUsername: string | null;
  hasToken: boolean;
  lastActivity: number | null;
  lastError: string | null;
  allowedUsers: string[];
  acceptAll: boolean;
  rich: boolean;
}

/** The slice of the Bot API we use, narrowed to what the gateway reads. */
interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
interface TelegramChat {
  id: number;
  type?: string;
}
/** A downloadable Telegram file reference (voice notes, audio, etc.). */
interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
}
interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: TelegramFile;
  audio?: TelegramFile;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  document?: { file_id: string; mime_type?: string; file_name?: string };
}
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const POLL_TIMEOUT_SECONDS = 50;
const PLAIN_MESSAGE_LIMIT = 4096;

/**
 * Telegram channel — a third feeder into the shared engine path (alongside the
 * WhatsApp gateway and the web /api/chat route). It long-polls the Bot API for
 * messages and replies through `engine.handleTasking`, so downstream processing
 * and per-chat context are identical to WhatsApp.
 *
 * Deliberately minimal vs the WhatsApp gateway: no QR pairing (a BotFather token
 * is the only credential), no read receipts, no session files. Config is
 * env-seeded (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`) — there is no
 * bespoke UI. Rich replies copy Hermes: the engine's markdown is passed straight
 * to `sendRichMessage`, with a transparent fall back to plain `sendMessage`.
 */
export class TelegramGateway {
  private state: TelegramConnectionState = "disconnected";
  private botUsername: string | null = null;
  private lastError: string | null = null;
  private lastActivity: number | null = null;
  private offset = 0;
  private running = false;
  private abort: AbortController | null = null;
  private loop: Promise<void> | null = null;

  /**
   * Owner chat IDs we've actually seen DM the bot. Telegram can only push to a
   * numeric chat_id (a @handle is NOT a valid send target), so to message the
   * owner unprompted we remember the chat IDs of allowed inbound senders and
   * persist them — surviving restarts that happen before the next inbound.
   */
  private knownChatIds = new Set<string>();
  private knownChatsLoaded = false;

  constructor(
    private readonly options: {
      settings: Settings;
      getEngine: () => Promise<BrainEngine>;
      dataDir?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private get knownChatsPath(): string | null {
    return this.options.dataDir ? join(this.options.dataDir, "known-chats.json") : null;
  }

  private loadKnownChats(): void {
    if (this.knownChatsLoaded) return;
    this.knownChatsLoaded = true;
    const path = this.knownChatsPath;
    if (!path) return;
    try {
      const ids = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (Array.isArray(ids)) for (const id of ids) this.knownChatIds.add(String(id));
    } catch {
      // First run / unreadable: start empty and re-learn from inbound messages.
    }
  }

  private rememberChat(chatId: number): void {
    this.loadKnownChats();
    const id = String(chatId);
    if (this.knownChatIds.has(id)) return;
    this.knownChatIds.add(id);
    const path = this.knownChatsPath;
    if (!path) return;
    try {
      mkdirSync(this.options.dataDir!, { recursive: true });
      writeFileSync(path, JSON.stringify([...this.knownChatIds]));
    } catch (err) {
      console.warn(`[telegram] could not persist known chat ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private settings(): TelegramSettings {
    return this.options.settings.telegramSettings();
  }

  status(): TelegramStatus {
    const settings = this.settings();
    return {
      enabled: settings.enabled,
      state: settings.enabled ? this.state : "disabled",
      botUsername: this.botUsername,
      hasToken: Boolean(this.options.settings.telegramBotToken()),
      lastActivity: this.lastActivity,
      lastError: this.lastError,
      allowedUsers: settings.allowedUsers,
      acceptAll: settings.acceptAll,
      rich: settings.rich,
    };
  }

  async startIfEnabled(): Promise<void> {
    if (this.settings().enabled) await this.start();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const token = this.options.settings.telegramBotToken();
    if (!token) {
      this.state = "error";
      this.lastError = "No Telegram bot token configured (set TELEGRAM_BOT_TOKEN).";
      return;
    }
    this.lastError = null;
    // Validate the token and learn the bot's @username before polling.
    const me = await this.callApi<TelegramUser>("getMe", {}).catch((err: unknown) => {
      this.state = "error";
      this.lastError = `Telegram getMe failed: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    });
    if (!me) return;
    this.botUsername = me.username ?? null;
    this.state = "connected";
    // Skip any backlog accumulated while we were down: advance the offset past
    // the newest pending update so a restart doesn't reply to stale messages.
    await this.primeOffset();
    this.running = true;
    this.abort = new AbortController();
    this.loop = this.pollLoop();
  }

  async disconnect(): Promise<void> {
    this.options.settings.setTelegramSettings({ enabled: false });
    await this.close();
  }

  async close(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
    const loop = this.loop;
    this.loop = null;
    this.state = "disconnected";
    await loop?.catch(() => {});
  }

  /** Fetch the latest pending update (if any) and set the offset just past it. */
  private async primeOffset(): Promise<void> {
    try {
      const updates = await this.callApi<TelegramUpdate[]>("getUpdates", { offset: -1, timeout: 0 });
      const last = updates?.[updates.length - 1];
      if (last) this.offset = last.update_id + 1;
    } catch {
      // Non-fatal: a transient error here just means we may process one batch of
      // backlog on first poll. The loop's own error handling takes over.
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.callApi<TelegramUpdate[]>(
          "getUpdates",
          { offset: this.offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ["message"] },
          (POLL_TIMEOUT_SECONDS + 15) * 1000,
        );
        if (this.state !== "connected") {
          this.state = "connected";
          this.lastError = null;
        }
        for (const update of updates ?? []) {
          this.offset = update.update_id + 1;
          if (update.message) await this.handleMessage(update.message);
        }
      } catch (err) {
        if (!this.running) break; // aborted by close()
        this.state = "error";
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error("[telegram] poll failed:", this.lastError);
        await this.delay(3000); // brief backoff before retrying
      }
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    this.lastActivity = Date.now();
    const chatId = message.chat.id;
    const from = message.from;
    const settings = this.settings();

    if (!userIsAllowed({ id: from?.id, username: from?.username }, settings)) {
      const who = from?.username ? `@${from.username}` : String(from?.id ?? "unknown");
      console.info(`[telegram] ignored message from non-allowed user ${who}`);
      return;
    }

    // Remember this owner's chat so the monitor can push proactive pings here.
    this.rememberChat(chatId);

    let text = (message.text ?? message.caption ?? "").trim();

    // Voice/audio notes mirror the WhatsApp path: transcribe through the SAME
    // global pipeline (shared whisper model + provider settings) and treat the
    // transcript as a typed prompt. A transcribed note IS a prompt — there is no
    // behavioral difference from typing, so it flows into the same tasking loop.
    const voice = message.voice ?? message.audio;
    if (!text && voice?.file_id) {
      await this.sendChatAction(chatId, "typing");
      let transcript: string;
      try {
        transcript = await this.transcribeVoice(voice);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[telegram] transcription failed for chat ${chatId}: ${detail}`);
        await this.sendReply(
          chatId,
          detail === NO_SPEECH_MESSAGE
            ? `⚠️ ${detail}`
            : "⚠️ I got your voice note, but couldn't transcribe it — please try again.",
        ).catch(() => {});
        return;
      }
      const sender = from?.username
        ? `@${from.username}`
        : from?.first_name || String(from?.id ?? "unknown");
      text = `Telegram voice note transcript from ${sender}:\n\n${transcript}`;
    }

    // Photos and image documents: describe with vision and file to vault.
    // Run this BEFORE the text/caption path — a captioned image must be handled
    // as an image (vision), not as plain caption text sent to handleTasking.
    const imageFileId =
      message.photo?.at(-1)?.file_id ??
      (message.document?.mime_type?.startsWith("image/") ? message.document.file_id : null);
    if (imageFileId) {
      await this.sendChatAction(chatId, "typing");
      try {
        const { data } = await this.downloadFile(imageFileId);
        const mimeType = message.document?.mime_type ?? "image/jpeg";
        const engine = await this.options.getEngine();
        const sender = from?.username ? `@${from.username}` : from?.first_name || String(from?.id ?? "unknown");
        const caption = message.caption?.trim() ?? "";
        const description = await engine.describeImage(new Uint8Array(data), mimeType);
        const captionLine = caption ? `\nCaption: ${caption}\n\n` : "\n\n";
        const text = `Telegram image from ${sender}:${captionLine}${description}`;
        const conversationKey = normalizeTelegramId(String(chatId)) || String(chatId);
        const reply = await engine.handleTasking({ text, surface: "telegram", conversationKey });
        if (reply.text.trim()) await this.sendReply(chatId, reply.text);
        this.spawnPeerJobPoller(reply, chatId);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`[telegram] image processing failed for chat ${chatId}: ${detail}`);
        await this.sendReply(chatId, "⚠️ I got your image but hit an error processing it — please try again.").catch(
          () => {},
        );
      }
      return;
    }

    if (!text) {
      await this.sendReply(
        chatId,
        "I can only handle text, voice messages, and images for now.",
      ).catch(() => {});
      return;
    }

    await this.sendChatAction(chatId, "typing");
    const keepTyping = setInterval(() => void this.sendChatAction(chatId, "typing"), 4000);
    keepTyping.unref?.();
    try {
      const engine = await this.options.getEngine();
      const reply = await engine.handleTasking({
        text,
        surface: "telegram",
        conversationKey: normalizeTelegramId(String(chatId)) || String(chatId),
      });
      if (reply.text.trim()) {
        await this.sendReply(chatId, reply.text);
        this.spawnPeerJobPoller(reply, chatId);
      } else {
        await this.sendReply(
          chatId,
          "⚠️ I got your message but couldn't compose a reply — please try again.",
        ).catch(() => {});
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const providerIssue =
        /quota|billing|rate.?limit|insufficient|api key|unauthor|401|429|overloaded|model provider|not configured/i.test(
          detail,
        );
      const notice = providerIssue
        ? "⚠️ I got your message, but the AI model is unavailable right now (out of quota, rate-limited, or misconfigured). Nothing was lost — please try again once that's sorted."
        : "⚠️ I got your message, but hit an error while processing it. It's been logged — please try again in a moment.";
      await this.sendReply(chatId, notice).catch(() => {});
      console.error(`[telegram] reply failed for chat ${chatId}: ${detail}`);
    } finally {
      clearInterval(keepTyping);
    }
  }

  /**
   * Download a Telegram voice/audio file and transcribe it through the shared
   * pipeline. Reuses the SAME global whisper model and provider settings the
   * WhatsApp gateway uses (`this.options.settings`), so model selection is a
   * single setting for all routes. Returns the transcript text or throws.
   */
  private async transcribeVoice(file: TelegramFile): Promise<string> {
    const { data, ext } = await this.downloadFile(file.file_id);
    const filename = `${file.file_unique_id ?? file.file_id}.${ext}`;
    const transcription = await transcribeAudio(data, filename, {
      model: this.options.settings.whisperModel(),
      groqApiKey: this.options.settings.get("groq_api_key"),
      openaiApiKey: this.options.settings.get("openai_api_key"),
      openrouterApiKey: this.options.settings.get("openrouter_api_key"),
      openrouterModel: this.options.settings.openrouterTranscriptionModel(),
      longTranscriptionProvider: this.options.settings.longTranscriptionProvider(),
      useOpenAiForLongAudio: this.options.settings.useOpenAiForLongTranscription(),
    });
    if (!transcription.success || !transcription.transcript) {
      throw new Error(transcription.error || "transcription returned no text");
    }
    return transcription.transcript;
  }

  /**
   * Resolve a Telegram `file_id` to its bytes. The Bot API is two-step: `getFile`
   * returns a `file_path`, which is then fetched from the file-download endpoint.
   * Returns the buffer plus the real file extension (from the path) so ffmpeg
   * gets an accurate format hint. Capped by Telegram's 20 MB download limit.
   */
  private async downloadFile(fileId: string): Promise<{ data: Buffer; ext: string }> {
    const token = this.options.settings.telegramBotToken();
    if (!token) throw new Error("Telegram bot token is not configured");
    const file = await this.callApi<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new Error("Telegram getFile returned no file_path");
    const signals = [AbortSignal.timeout(60000)];
    if (this.abort) signals.push(this.abort.signal);
    const response = await this.fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.any(signals),
    });
    if (!response.ok) throw new Error(`Telegram file download returned ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    const ext = file.file_path.includes(".") ? file.file_path.split(".").pop()! : "ogg";
    return { data, ext };
  }

  /**
   * Proactively message the owner(s) with no inbound event — the Telegram twin
   * of WhatsAppGateway.notifyOwner. The backlog monitor calls this (via
   * POST /api/notify with surface:"telegram") so a Codex job landing/blocking is
   * reported back on the channel the ticket was opened from. Targets are the
   * union of chats we've seen the owner DM from and any numeric allowlist IDs
   * (a @handle is not a valid send target, so it's skipped here).
   */
  async notifyOwner(text: string): Promise<{ sent: number; recipients: string[] }> {
    if (!text?.trim()) return { sent: 0, recipients: [] };
    if (!this.options.settings.telegramBotToken()) return { sent: 0, recipients: [] };
    this.loadKnownChats();
    const numericAllowed = this.settings().allowedUsers.filter((u) => /^-?\d+$/.test(u));
    const targets = [...new Set([...this.knownChatIds, ...numericAllowed])];
    const recipients: string[] = [];
    for (const target of targets) {
      const chatId = Number(target);
      if (!Number.isFinite(chatId)) continue;
      try {
        for (const chunk of chunkText(text, PLAIN_MESSAGE_LIMIT)) {
          await this.callApi("sendMessage", { chat_id: chatId, text: chunk });
        }
        recipients.push(target);
      } catch (err) {
        console.error(`[telegram] notifyOwner failed for chat ${target}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { sent: recipients.length, recipients };
  }

  /**
   * Rich-then-plain reply. Copies Hermes: pass the engine's raw markdown to
   * Bot API 10.1 `sendRichMessage` so tables/headings/lists/details render
   * natively; on any rejection (unknown method on older Bot API, oversized
   * payload >32 KB, malformed content) fall back transparently to plain
   * `sendMessage`, which is chunked to Telegram's 4096-char limit.
   *
   * The rich content is the `rich_message` parameter — an InputRichMessage
   * object whose `markdown` field carries the RAW agent markdown (NOT a `text`
   * field; unknown params are silently ignored, which only yields partial
   * inline parsing and drops tables/headings). Matches Hermes'
   * `gateway/platforms/telegram.py`. See zenod-ai/zenod#121.
   */
  private spawnPeerJobPoller(reply: { text: string; actions: Array<{ result: string }> }, chatId: number): void {
    const jobId = extractJobId(reply);
    if (!jobId) return;
    const peers = this.options.settings.peers();
    if (!peers.length) return;
    void pollPeerJob(peers, jobId).then((result) => {
      if (result.status === "done")
        return this.sendReply(chatId, "✓ Filed to vault.");
      if (result.status === "error")
        return this.sendReply(chatId, "⚠️ Filing failed — let me know if you'd like to retry.");
    }).catch(() => {});
  }

  private async sendReply(chatId: number, markdown: string): Promise<void> {
    if (!markdown) return;
    if (this.settings().rich) {
      try {
        await this.callApi("sendRichMessage", { chat_id: chatId, rich_message: { markdown } });
        return;
      } catch (err) {
        console.warn(
          `[telegram] sendRichMessage rejected, falling back to plain: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    for (const chunk of chunkText(markdown, PLAIN_MESSAGE_LIMIT)) {
      await this.callApi("sendMessage", { chat_id: chatId, text: chunk });
    }
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    await this.callApi("sendChatAction", { chat_id: chatId, action }).catch((err: unknown) => {
      console.warn(`[telegram] sendChatAction failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** POST a Bot API method as JSON and unwrap `{ ok, result }`, throwing on failure. */
  private async callApi<T>(method: string, body: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const token = this.options.settings.telegramBotToken();
    if (!token) throw new Error("Telegram bot token is not configured");
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (this.abort) signals.push(this.abort.signal);
    const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
    const json = (await response.json().catch(() => ({}))) as ApiResponse<T>;
    if (!response.ok || !json.ok) {
      throw new Error(`Telegram ${method} returned ${response.status}${json.description ? `: ${json.description}` : ""}`);
    }
    return json.result as T;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      this.abort?.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/** Split text into chunks no longer than `limit`, preferring line boundaries. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if (current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
