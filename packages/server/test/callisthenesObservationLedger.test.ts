import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CallisthenesObservationLedger, observedContentId } from "../src/callisthenesObservationLedger.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "callisthenes-held-actions-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Callisthenes held-action ledger", () => {
  it("uses unique action identity and fails closed across text, tenant, expiry, and consumption", async () => {
    const dataDir = await tempDir();
    let now = new Date("2026-07-12T20:00:00.000Z");
    const ledger = new CallisthenesObservationLedger(dataDir, { pendingTtlMs: 1_000, now: () => now });

    const first = ledger.hold("tenant-a", "Exact bytes");
    expect(ledger.hold("tenant-a", "Exact bytes").id).toBe(first.id);
    expect(ledger.resolve("tenant-a", { actionId: first.id, text: "Changed bytes" })).toBeNull();
    expect(ledger.resolve("tenant-b", { actionId: first.id, text: "Exact bytes" })).toBeNull();
    expect(ledger.resolve("tenant-a", { actionId: first.id, text: "Exact bytes" })?.id).toBe(first.id);

    ledger.recordReceipt("tenant-a", first.id, "Posted. Live URL: https://x.com/i/web/status/100", "https://x.com/i/web/status/100");
    expect(ledger.resolve("tenant-a", { actionId: first.id, text: "Exact bytes" })).toBeNull();
    expect(ledger.replayReceipt("tenant-a", { actionId: first.id, text: "Exact bytes" })?.draft_id).toBe(first.id);
    expect(ledger.replayReceipt("tenant-a", { actionId: first.id, text: "Changed bytes" })).toBeNull();

    const second = ledger.hold("tenant-a", "Exact bytes");
    expect(second.id).not.toBe(first.id);
    expect(ledger.resolve("tenant-a", { text: "Exact bytes" })?.id).toBe(second.id);

    now = new Date("2026-07-12T20:00:02.000Z");
    expect(ledger.resolve("tenant-a", { actionId: second.id, text: "Exact bytes" })).toBeNull();
    expect(ledger.read("tenant-a").drafts.find((draft) => draft.id === second.id)?.status).toBe("expired");
  });

  it("expires legacy pending rows without granting them a permanent approval window", async () => {
    const dataDir = await tempDir();
    const ledger = new CallisthenesObservationLedger(dataDir, {
      pendingTtlMs: 1_000,
      now: () => new Date("2026-07-12T20:00:02.000Z"),
    });
    await writeFile(ledger.path, JSON.stringify({
      "tenant-a": {
        drafts: [{ id: "legacy-content-id", text: "Legacy", status: "pending", created_at: "2026-07-12T20:00:00.000Z" }],
        receipts: [],
        usage: { calls: 0, sends: 0, rejected_drafts: 1, throttled: 0 },
      },
    }));

    expect(ledger.resolve("tenant-a", { actionId: "legacy-content-id", text: "Legacy" })).toBeNull();
    expect(ledger.read("tenant-a").drafts[0]).toMatchObject({
      id: "legacy-content-id",
      status: "expired",
      expires_at: "2026-07-12T20:00:01.000Z",
    });
  });

  it("replays a unique legacy receipt-only row without shadowing a new pending same-text action", async () => {
    const dataDir = await tempDir();
    const ledger = new CallisthenesObservationLedger(dataDir);
    const legacyId = observedContentId("tenant-a", "Legacy sent text");
    await writeFile(ledger.path, JSON.stringify({
      "tenant-a": {
        drafts: [],
        receipts: [{
          id: "legacy-receipt",
          draft_id: legacyId,
          text: "Posted to X. Live URL: https://x.com/i/web/status/200",
          url: "https://x.com/i/web/status/200",
          created_at: "2026-07-11T20:00:00.000Z",
        }],
        usage: { calls: 0, sends: 1, rejected_drafts: 0, throttled: 0 },
      },
    }));

    expect(ledger.replayReceipt("tenant-a", { text: "Legacy sent text" })?.id).toBe("legacy-receipt");
    expect(ledger.replayReceipt("tenant-a", { actionId: legacyId, text: "Legacy sent text" })?.id).toBe("legacy-receipt");
    expect(ledger.replayReceipt("tenant-a", { actionId: legacyId, text: "Altered" })).toBeNull();

    const pending = ledger.hold("tenant-a", "Legacy sent text");
    expect(ledger.resolve("tenant-a", { text: "Legacy sent text" })?.id).toBe(pending.id);
  });
});
