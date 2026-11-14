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
      mkdir(join(siteDist, "brand"), { recursive: true }),
      mkdir(join(siteDist, "start"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(siteDist, "index.html"), "<html>Zenod public landing</html>"),
      writeFile(join(siteDist, "assets", "site.js"), "site asset"),
      writeFile(join(siteDist, "connect.html"), "<html>Connect Zenod</html>"),
      writeFile(join(siteDist, "start.html"), "<html>Start with Zenod</html>"),
      writeFile(join(siteDist, "start", "zenod-start.mp4"), "0123456789"),
      writeFile(join(siteDist, "brand", "zenod-icon.svg"), "<svg>Z</svg>"),
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

  it("serves the connect guide and brand icons on the public host only", async () => {
    await expect((await app.request("https://zenod.dev/connect")).text()).resolves.toContain("Connect Zenod");
    await expect((await app.request("https://zenod.dev/brand/zenod-icon.svg")).text()).resolves.toBe("<svg>Z</svg>");
    expect((await app.request("https://cloud.zenod.dev/connect")).status).toBe(404);
  });

  it("serves the tester start page and its video on the public host only, with range support", async () => {
    await expect((await app.request("https://zenod.dev/start")).text()).resolves.toContain("Start with Zenod");
    const video = await app.request("https://zenod.dev/start/zenod-start.mp4");
    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toContain("video/mp4");
    const part = await app.request("https://zenod.dev/start/zenod-start.mp4", { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    await expect(part.text()).resolves.toBe("2345");
    expect((await app.request("https://cloud.zenod.dev/start")).status).toBe(404);
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
