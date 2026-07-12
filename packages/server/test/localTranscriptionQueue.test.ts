import { describe, expect, it } from "vitest";

import { runLocalTranscriptionSerialized } from "../src/localTranscriptionQueue.js";

describe("local transcription queue", () => {
  it("runs local Whisper work one process at a time", async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const run = (name: string) =>
      runLocalTranscriptionSerialized(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}:end`);
        active -= 1;
        return name;
      });

    await expect(Promise.all([run("one"), run("two")])).resolves.toEqual(["one", "two"]);
    expect(peak).toBe(1);
    expect(order).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });

  it("releases the next task when a transcription fails", async () => {
    const failed = runLocalTranscriptionSerialized(async () => {
      throw new Error("whisper failed");
    });
    const recovered = runLocalTranscriptionSerialized(async () => "recovered");

    await expect(failed).rejects.toThrow("whisper failed");
    await expect(recovered).resolves.toBe("recovered");
  });
});
