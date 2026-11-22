import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Runtime } from "../src/runtime.js";
import { cpuMark, cpuSince, emptyQuickIndexState, firstTickDelayMs, QuickIndexStore, quickIndexTickLine } from "../src/quickIndex.js";

// EPIC-24 M34 round 3: every tenant logs one tick line, whatever the outcome, with its CPU; the clocks are spread.
const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) { try { runtime.close(); } catch { /* closed by its test */ } }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runtimeFor(tenantId: string, vault: boolean): Promise<Runtime> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-tick-")); dirs.push(dir);
  const runtime = new Runtime(dir, undefined, { tenantId });
  runtimes.push(runtime);
  vi.spyOn(runtime.settings, "vaultConfigured").mockReturnValue(vault);
  return runtime;
}

const tickLines = (log: ReturnType<typeof vi.spyOn>) => log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[quick-index] tick "));

describe("one tick line per tenant per tick (M34 round 3)", () => {
  it("a tenant with no vault logs result=no-vault and costs nothing", async () => {
    const runtime = await runtimeFor("t-novault", false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const getEngine = vi.spyOn(runtime, "getEngine");
    expect(await runtime.refreshQuickIndex()).toBeNull();
    expect(getEngine).not.toHaveBeenCalled();
    const [line] = tickLines(log);
    expect(line).toMatch(/^\[quick-index\] tick tenant=t-novault .* result=no-vault cpu=\d+ms child=\d+ms$/);
  });

  it("a tenant whose vault has no tree logs result=no-tree with the engine's phases, and the note says nothing about places", async () => {
    const runtime = await runtimeFor("t-notree", true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runtime.getEngine = (async () => ({ quickIndexBase: async (phases: { skipped?: string; pullMs?: number }) => { phases.skipped = "no-tree"; phases.pullMs = 0; return null; } })) as unknown as Runtime["getEngine"];
    expect(await runtime.refreshQuickIndex(Date.now(), { personasMs: 7 })).toBeNull();
    const [line] = tickLines(log);
    expect(line).toContain("tenant=t-notree");
    expect(line).toContain("pull=0ms(none)");
    expect(line).toMatch(/result=no-tree cpu=\d+ms child=\d+ms personas=7ms$/);
    expect(tickLines(log)).toHaveLength(1);
  });

  it("a failing tick logs result=error once and still rejects to its caller", async () => {
    const runtime = await runtimeFor("t-broken", true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runtime.getEngine = (async () => { throw new Error("vault unreadable"); }) as unknown as Runtime["getEngine"];
    await expect(runtime.refreshQuickIndex()).rejects.toThrow("vault unreadable");
    expect(tickLines(log)).toHaveLength(1);
    expect(tickLines(log)[0]).toContain("result=error");
  });

  it("a tenant with a tree logs result=ok, after the update, exactly once", async () => {
    const runtime = await runtimeFor("t-tree", true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const base = { places: [], weekFrom: "2026-11-16" };
    runtime.getEngine = (async () => ({ quickIndexBase: async (phases: { pullMs?: number; statMs?: number; rebuildMs?: number; rebuilt?: boolean }) => { Object.assign(phases, { pullMs: 3, statMs: 4, rebuildMs: 0, rebuilt: false }); return base; } })) as unknown as Runtime["getEngine"];
    const update = await runtime.refreshQuickIndex();
    expect(update).not.toBeNull();
    expect(tickLines(log)).toHaveLength(1);
    expect(tickLines(log)[0]).toMatch(/tenant=t-tree pull=3ms\(none\) stat=4ms rebuild=0ms\(cached\) update=\d+ms total=\d+ms result=ok cpu=\d+ms child=\d+ms$/);
  });
});

describe("tick line format and CPU marks", () => {
  it("keeps the old line when no extras are given, and appends result, cpu and child when they are", () => {
    const plain = quickIndexTickLine("t-1", { pullMs: 5, statMs: 6, rebuildMs: 0, rebuilt: false }, 1, 20);
    expect(plain).toBe("[quick-index] tick tenant=t-1 pull=5ms(none) stat=6ms rebuild=0ms(cached) update=1ms total=20ms");
    expect(quickIndexTickLine("t-1", { skipped: "no-tree" }, 0, 2, { result: "no-tree", cpu: { selfMs: 3, childMs: 40 }, personasMs: 1 }))
      .toBe("[quick-index] tick tenant=t-1 pull=0ms(none) stat=0ms rebuild=0ms(cached) update=0ms total=2ms result=no-tree cpu=3ms child=40ms personas=1ms");
  });

  it("measures this process's CPU and the CPU of the processes it waited for", () => {
    const before = cpuMark();
    // Burn until this process has used 30 ms of CPU (wall time says nothing on a loaded machine).
    const wallCap = Date.now() + 10_000;
    while (cpuSince(before).selfMs < 30 && Date.now() < wallCap) { /* burn */ }
    expect(cpuSince(before).selfMs).toBeGreaterThanOrEqual(30);
    if (process.platform === "linux") {
      const mid = cpuMark();
      spawnSync(process.execPath, ["-e", "const t=process.cpuUsage();while(process.cpuUsage(t).user<250000){}"]);
      expect(cpuSince(mid).childMs).toBeGreaterThanOrEqual(150);
    }
  });
});

describe("clocks are spread, and an idle tick writes nothing", () => {
  it("gives each tenant its own first tick, at least a minute after boot and inside the first interval, the same every time", () => {
    const interval = 5 * 60_000;
    const ids = ["tenant-a", "tenant-b", "tenant-c", "tenant-d", "tenant-e", "tenant-f", "tenant-g"];
    const delays = ids.map((id) => firstTickDelayMs(id, interval));
    for (const delay of delays) { expect(delay).toBeGreaterThanOrEqual(60_000); expect(delay).toBeLessThan(interval); }
    expect(new Set(delays).size).toBe(ids.length);
    expect(ids.map((id) => firstTickDelayMs(id, interval))).toEqual(delays);
    // A very short interval (a test) still ticks inside it.
    expect(firstTickDelayMs("tenant-a", 100)).toBeLessThan(100);
  });

  it("ticks once per interval after the first, on the tenant's own offset", async () => {
    vi.useFakeTimers();
    const runtime = await runtimeFor("tenant-b", true);
    const wake = vi.spyOn(runtime, "wakePersonas").mockResolvedValue([]);
    const refresh = vi.spyOn(runtime, "refreshQuickIndex").mockResolvedValue(null);
    runtime.startTreeSweepSchedule(300_000);
    runtime.startTreeSweepSchedule(300_000); // idempotent
    const first = firstTickDelayMs("tenant-b", 300_000);
    await vi.advanceTimersByTimeAsync(first - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![1]).toMatchObject({ since: expect.any(Object), personasMs: expect.any(Number) });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    runtimes.splice(runtimes.indexOf(runtime), 1);
    runtime.close();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("writes the quick-index state only when it changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-qi-store-")); dirs.push(dir);
    const store = new QuickIndexStore(dir);
    const state = emptyQuickIndexState();
    store.write(state);
    const file = join(dir, "quick-index.json");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(file, old, old);
    store.write(state);
    expect((await stat(file)).mtimeMs).toBeLessThan(Date.now() - 3_000_000);
    store.write({ ...state, corrections: { x: { name: "y" } as never } });
    expect((await stat(file)).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
    expect(Object.keys(store.read().corrections)).toEqual(["x"]);
  });
});
