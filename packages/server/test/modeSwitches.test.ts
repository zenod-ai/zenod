import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modeSwitchesPath, parseModeSwitch, readModeSwitches, recordModeSwitch } from "../src/modeSwitches.js";

const AT = new Date("2026-11-09T21:00:00Z");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("E22-L3 mode switches", () => {
  it("parses a switch with the message, Zenod's pick, who picked it and the new mode", () => {
    expect(parseModeSwitch({ message: " Ana's birthday is 14 March ", from: "keep", by: "model", to: "lookup" }, AT)).toEqual({
      at: "2026-11-09T21:00:00.000Z", message: "Ana's birthday is 14 March", from: "keep", by: "model", to: "lookup",
    });
    expect(parseModeSwitch({ message: "should I move?", from: "both", to: "talk" }, AT)?.by).toBe("rules");
  });

  it("refuses what is not a switch: no message, unknown modes, or the mode already picked", () => {
    expect(parseModeSwitch(null, AT)).toBeNull();
    expect(parseModeSwitch({ message: "", from: "keep", to: "lookup" }, AT)).toBeNull();
    expect(parseModeSwitch({ message: "x", from: "nope", to: "lookup" }, AT)).toBeNull();
    expect(parseModeSwitch({ message: "x", from: "keep", to: "both" }, AT)).toBeNull();
    expect(parseModeSwitch({ message: "x", from: "answer", to: "lookup" }, AT)).toBeNull();
    expect(parseModeSwitch({ message: "x", from: "talk", to: "talk" }, AT)).toBeNull();
    expect(parseModeSwitch({ message: "x".repeat(100_000), from: "keep", to: "lookup" }, AT)).toBeNull();
  });

  it("appends each switch to a private file in the tenant's data folder and reads them back", () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-switch-"));
    dirs.push(dir);
    expect(readModeSwitches(dir)).toEqual([]);
    const one = parseModeSwitch({ message: "untangle my notes", from: "keep", to: "job" }, AT)!;
    const two = parseModeSwitch({ message: "what do you think about Lisbon", from: "answer", to: "talk" }, AT)!;
    recordModeSwitch(dir, one);
    recordModeSwitch(dir, two);
    expect(readModeSwitches(dir)).toEqual([one, two]);
    expect(statSync(modeSwitchesPath(dir)).mode & 0o777).toBe(0o600);
  });
});
