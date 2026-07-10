import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("site and dashboard routing", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-static-routing-"));
    const siteDist = join(dir, "site");
    const webDist = join(dir, "web");
    await Promise.all([
      mkdir(join(siteDist, "assets"), { recursive: true }),
      mkdir(join(webDist, "assets"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(siteDist, "index.html"), "<html>Zenod public landing</html>"),
      writeFile(join(siteDist, "assets", "site.js"), "site asset"),
      writeFile(join(webDist, "index.html"), "<html>Zenod dashboard</html>"),
      writeFile(join(webDist, "assets", "dashboard.js"), "dashboard asset"),
    ]);
    runtime = new Runtime(join(dir, "data"));
    app = createApp(runtime, { siteDist, webDist });
  });

  afterEach(async () => {
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the public landing and pricing documents at product routes", async () => {
    await expect((await app.request("https://zenod.dev/")).text()).resolves.toContain("public landing");
    await expect((await app.request("https://zenod.dev/pricing")).text()).resolves.toContain("public landing");
    await expect((await app.request("/site/assets/site.js")).text()).resolves.toBe("site asset");
  });

  it("serves the dashboard SPA at cloud root and account for the transplanted customer layer", async () => {
    await expect((await app.request("https://cloud.zenod.dev/")).text()).resolves.toContain("dashboard");
    await expect((await app.request("https://cloud.zenod.dev/account")).text()).resolves.toContain("dashboard");
    expect((await app.request("https://cloud.zenod.dev/pricing")).status).toBe(404);
  });

  it("mounts the dashboard and its fallback under /app", async () => {
    await expect((await app.request("/app")).text()).resolves.toContain("dashboard");
    await expect((await app.request("/app/settings")).text()).resolves.toContain("dashboard");
    await expect((await app.request("/assets/dashboard.js")).text()).resolves.toBe("dashboard asset");
  });
});
