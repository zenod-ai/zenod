import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withVaultWriteLock } from "../src/git/vaultWriteLock.js";
import { WriteQueue } from "../src/git/queue.js";

const roots: string[] = [];
async function vault() {
  const root = await mkdtemp(join(tmpdir(), "zenod-writer-lock-")); roots.push(root);
  const path = join(root, "vault"); await mkdir(path); return { root, path };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }

describe("vault writer ownership", () => {
  it("allows same-operation reentrancy but fences unrelated callers and symlink aliases", async () => {
    const { root, path } = await vault(); const held = gate(); const entered = gate();
    const alias = join(root, "alias"); await symlink(path, alias);
    const first = withVaultWriteLock(path, async () => {
      await withVaultWriteLock(alias, async () => { entered.release(); });
      await held.wait;
    });
    await entered.wait;
    await expect(withVaultWriteLock(alias, async () => "wrong", 0)).rejects.toMatchObject({ code: "vault_write_busy" });
    held.release(); await first;
    await expect(withVaultWriteLock(alias, async () => "after", 0)).resolves.toBe("after");
  });

  it("does not let inherited async context bypass a new owner after release", async () => {
    const { path } = await vault(); const delayed = gate(); const held = gate(); const entered = gate();
    let stale!: Promise<unknown>;
    await withVaultWriteLock(path, async () => {
      stale = delayed.wait.then(() => withVaultWriteLock(path, async () => "stale escaped", 0));
    });
    const next = withVaultWriteLock(path, async () => { entered.release(); await held.wait; });
    await entered.wait;
    const check = expect(stale).rejects.toMatchObject({ code: "vault_write_busy" });
    delayed.release(); await check; held.release(); await next;
  });

  it("releases a crashed process without stealing from a live owner", async () => {
    const { path } = await vault();
    const moduleUrl = new URL("../src/git/vaultWriteLock.ts", import.meta.url).href;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      `import { withVaultWriteLock } from ${JSON.stringify(moduleUrl)}; await withVaultWriteLock(${JSON.stringify(path)}, async () => { console.log('held'); await new Promise(resolve => setInterval(resolve, 60_000)); });`],
      { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const [data] = await once(child.stdout!, "data"); expect(String(data)).toContain("held");
      await expect(withVaultWriteLock(path, async () => "wrong", 20)).rejects.toMatchObject({ code: "vault_write_busy" });
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      await expect(withVaultWriteLock(path, async () => "recovered", 100)).resolves.toBe("recovered");
    } finally { child.kill("SIGKILL"); }
  });

  it("serializes simultaneous first-ever acquisition by independent processes", async () => {
    const { path } = await vault();
    const moduleUrl = new URL("../src/git/vaultWriteLock.ts", import.meta.url).href;
    const children = [0, 1].map(() => spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      `import { withVaultWriteLock } from ${JSON.stringify(moduleUrl)}; process.stdin.once('data', async () => { await withVaultWriteLock(${JSON.stringify(path)}, async () => { console.log('entered'); await new Promise(resolve => setTimeout(resolve, 50)); console.log('leaving'); }); process.exit(0); }); console.log('ready');`],
      { stdio: ["pipe", "pipe", "inherit"] }));
    try {
      await Promise.all(children.map(child => once(child.stdout!, "data")));
      const events: string[] = [];
      children.forEach((child, index) => child.stdout!.on("data", data => events.push(...String(data).trim().split("\n").map(event => `${index}:${event}`))));
      const exits = children.map(child => once(child, "exit"));
      children.forEach(child => child.stdin!.write("start"));
      expect(await Promise.all(exits)).toEqual([[0, null], [0, null]]);
      expect(events).toHaveLength(4);
      expect(events[0]!.split(":")[0]).toBe(events[1]!.split(":")[0]);
      expect(events[2]!.split(":")[0]).toBe(events[3]!.split(":")[0]);
    } finally { children.forEach(child => child.kill("SIGKILL")); }
  });

  it("closes the connection when initialization fails and permits the next acquisition", async () => {
    const { path } = await vault();
    const close = vi.spyOn(DatabaseSync.prototype, "close");
    const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementationOnce(() => { throw new Error("initialization failed"); });
    try {
      await expect(withVaultWriteLock(path, async () => undefined)).rejects.toThrow("initialization failed");
      expect(close).toHaveBeenCalledTimes(1);
      await expect(withVaultWriteLock(path, async () => "next", 0)).resolves.toBe("next");
      expect(close).toHaveBeenCalledTimes(2);
    } finally { exec.mockRestore(); close.mockRestore(); }
  });

  it("preserves queue lanes and keeps heartbeat timers running while waiting across queues", async () => {
    const { path } = await vault(); const first = new WriteQueue(path); const second = new WriteQueue(path);
    const held = gate(); const entered = gate(); const order: string[] = []; let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const active = first.run(async () => { entered.release(); await held.wait; order.push("first"); });
    await entered.wait;
    const waiting = second.run(async () => { order.push("second"); }, "background");
    await new Promise(r => setTimeout(r, 30)); expect(ticks).toBeGreaterThan(1);
    held.release(); await Promise.all([active, waiting]); clearInterval(timer);
    expect(order).toEqual(["first", "second"]);
  });
});
