import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports ok with the engine version", async () => {
    const res = await createApp().request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("zenod");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
