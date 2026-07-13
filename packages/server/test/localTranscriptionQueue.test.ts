import { describe, expect, it, vi } from "vitest";
import { runLocalTranscriptionSerialized } from "../src/localTranscriptionQueue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("local transcription FIFO", () => {
  it("keeps peak concurrency at one and lets the queue progress after an aborted waiter", async () => {
    const firstRelease = deferred();
    const firstStarted = deferred();
    let active = 0;
    let peak = 0;
    const ran: string[] = [];
    const task = async (name: string, hold?: Promise<void>) => {
      active += 1;
      peak = Math.max(peak, active);
      ran.push(name);
      if (name === "first") firstStarted.resolve();
      if (hold) await hold;
      active -= 1;
      return name;
    };

    const first = runLocalTranscriptionSerialized(() => task("first", firstRelease.promise));
    await firstStarted.promise;
    const controller = new AbortController();
    const second = runLocalTranscriptionSerialized(() => task("second"), controller.signal);
    const third = runLocalTranscriptionSerialized(() => task("third"));
    controller.abort();

    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toEqual(["first"]);
    firstRelease.resolve();
    await expect(first).resolves.toBe("first");
    await expect(third).resolves.toBe("third");
    expect(ran).toEqual(["first", "third"]);
    expect(peak).toBe(1);
  });

  it("releases the next task when an acquired transcription fails", async () => {
    const failed = runLocalTranscriptionSerialized(async () => {
      throw new Error("whisper failed");
    });
    const recovered = runLocalTranscriptionSerialized(async () => "recovered");

    await expect(failed).rejects.toThrow("whisper failed");
    await expect(recovered).resolves.toBe("recovered");
  });

  it("removes the abort listener when the predecessor wins", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    await expect(runLocalTranscriptionSerialized(async () => "done", controller.signal)).resolves.toBe("done");
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0]?.[1]).toBe(add.mock.calls[0]?.[1]);
  });
});
