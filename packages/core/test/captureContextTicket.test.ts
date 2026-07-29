import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteStateStore } from "../src/state/sqlite.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SqliteStateStore capture context tickets", () => {
  it("atomically appends one summary-and-evidence context message across retries and restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ring-capture-context-"));
    dirs.push(dir);
    const path = join(dir, "ring.sqlite");
    const conversationId = "whatsapp:whatsapp:34611111111";
    const ticket = {
      identity: {
        tenantId: "tenant-alpha",
        surface: "whatsapp" as const,
        conversationKey: "whatsapp:34611111111",
        providerMessageId: "42",
      },
      summary: "The note compares Girona housing options.",
      evidenceRef: "Log/2026-07-29.md#^e-a1b2c3",
    };

    const first = new SqliteStateStore(path, "tenant-alpha");
    expect(await first.appendCaptureTicket(ticket)).toBe("recorded");
    expect(await first.appendCaptureTicket(ticket)).toBe("duplicate");
    expect(await first.recentWindow(conversationId)).toMatchObject([
      {
        role: "assistant",
        surface: "whatsapp",
        text: [
          "Capture context:",
          "Summary: The note compares Girona housing options.",
          "Evidence: Log/2026-07-29.md#^e-a1b2c3",
        ].join("\n"),
      },
    ]);
    first.close();

    const restarted = new SqliteStateStore(path, "tenant-alpha");
    expect(await restarted.appendCaptureTicket(ticket)).toBe("duplicate");
    expect(await restarted.recentWindow(conversationId)).toHaveLength(1);
    restarted.close();
  });

  it("does not collapse the same provider id across surfaces or conversation namespaces", async () => {
    const store = new SqliteStateStore(":memory:", "tenant-alpha");
    const ticket = (
      surface: "whatsapp" | "telegram",
      conversationKey: string,
      summary: string,
    ) => ({
      identity: {
        tenantId: "tenant-alpha",
        surface,
        conversationKey,
        providerMessageId: "42",
      },
      summary,
      evidenceRef: `Log/2026-07-29.md#^e-${surface}-${conversationKey}`,
    });

    expect(await store.appendCaptureTicket(ticket("whatsapp", "whatsapp:chat-a", "WhatsApp capture."))).toBe("recorded");
    expect(await store.appendCaptureTicket(ticket("telegram", "telegram:chat-a", "Telegram capture."))).toBe("recorded");
    expect(await store.appendCaptureTicket(ticket("whatsapp", "whatsapp:chat-b", "Other WhatsApp chat."))).toBe("recorded");
    expect(await store.appendCaptureTicket(ticket("whatsapp", "whatsapp:chat-a", "Retry ignored."))).toBe("duplicate");

    expect(await store.recentWindow("whatsapp:whatsapp:chat-a")).toHaveLength(1);
    expect(await store.recentWindow("telegram:telegram:chat-a")).toHaveLength(1);
    expect(await store.recentWindow("whatsapp:whatsapp:chat-b")).toHaveLength(1);
    store.close();
  });

  it("migrates legacy capture-id rows into the canonical tenant/surface/conversation identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ring-capture-context-migration-"));
    dirs.push(dir);
    const path = join(dir, "ring.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        surface TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE conversation_capture_tickets (
        capture_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `);
    legacy.prepare(
      `INSERT INTO conversation_capture_tickets
       (capture_id, conversation_id, summary, evidence_ref, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("42", "whatsapp:whatsapp:chat-a", "Legacy capture.", "Log/legacy.md#^e-42", 1);
    legacy.close();

    const migrated = new SqliteStateStore(path, "tenant-alpha");
    const sameIdentity = {
      identity: {
        tenantId: "tenant-alpha",
        surface: "whatsapp" as const,
        conversationKey: "whatsapp:chat-a",
        providerMessageId: "42",
      },
      summary: "Retry after migration.",
      evidenceRef: "Log/retry.md#^e-42",
    };
    expect(await migrated.appendCaptureTicket(sameIdentity)).toBe("duplicate");
    expect(await migrated.appendCaptureTicket({
      ...sameIdentity,
      identity: {
        ...sameIdentity.identity,
        surface: "telegram",
        conversationKey: "telegram:chat-a",
      },
    })).toBe("recorded");
    await expect(migrated.appendCaptureTicket({
      ...sameIdentity,
      identity: { ...sameIdentity.identity, tenantId: "tenant-beta" },
    })).rejects.toThrow("tenant identity");
    migrated.close();
  });
});
