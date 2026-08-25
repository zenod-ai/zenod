import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedAiAdmissionInput } from "../src/customerManagedAiAdmission.js";
import { ManagedAiDownstreamOutbox } from "../src/customerManagedAiOutbox.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function input(path = "/api/store"): ManagedAiAdmissionInput {
  return {
    tenantId: "tenant-42",
    idempotencyKey: "provider-message-42",
    kind: "text",
    method: "POST",
    path,
    contentType: "application/json",
    raw: Buffer.from('{"content":"remember this"}'),
  };
}

describe("managed AI downstream outbox", () => {
  it("replays a durable downstream response after admission crashes before its receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-outbox-"));
    dirs.push(dir);
    const path = join(dir, "outbox.sqlite");
    const processor = vi.fn(async () => Response.json({ stored: true }));
    const first = new ManagedAiDownstreamOutbox(path);
    expect(await (await first.execute(input(), processor)).json()).toEqual({ stored: true });
    first.close();

    const restarted = new ManagedAiDownstreamOutbox(path);
    try {
      expect(await (await restarted.execute(input(), processor)).json()).toEqual({ stored: true });
      expect(processor).toHaveBeenCalledTimes(1);
    } finally {
      restarted.close();
    }
  });

  it.each(["/api/chat", "/mcp", "/internal/telegram"])(
    "never repeats an ambiguous %s invocation after lease expiry",
    async (pathName) => {
      const dir = await mkdtemp(join(tmpdir(), "zenod-managed-outbox-crash-"));
      dirs.push(dir);
      const path = join(dir, "outbox.sqlite");
      let now = 1_000;
      const processor = vi.fn(async () => Response.json({ committed: true }));
      const crashing = new ManagedAiDownstreamOutbox(path, {
        now: () => now,
        leaseMs: 100,
        afterProcessorBeforePersist: () => {
          throw new Error("fault: process died after downstream commit");
        },
      });
      await expect(crashing.execute(input(pathName), processor)).rejects.toThrow("process died");
      crashing.close();

      now = 1_101;
      const restarted = new ManagedAiDownstreamOutbox(path, { now: () => now, leaseMs: 100 });
      try {
        const response = await restarted.execute(input(pathName), processor);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "managed operation was interrupted after dispatch; it was not replayed",
          code: "downstream_interrupted",
        });
        const replay = await restarted.execute(input(pathName), processor);
        expect(replay.status).toBe(503);
        expect(processor).toHaveBeenCalledTimes(1);
      } finally {
        restarted.close();
      }
    },
  );

  it("rejects reuse of an idempotency key for different raw evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-outbox-conflict-"));
    dirs.push(dir);
    const outbox = new ManagedAiDownstreamOutbox(join(dir, "outbox.sqlite"));
    try {
      await outbox.execute(input(), async () => Response.json({ ok: true }));
      const changed = { ...input(), raw: Buffer.from('{"content":"different"}') };
      expect((await outbox.execute(changed, vi.fn())).status).toBe(409);
    } finally {
      outbox.close();
    }
  });
});
