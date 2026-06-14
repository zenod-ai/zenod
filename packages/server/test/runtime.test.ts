import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalTaskingTools } from "zenod";
import { Runtime } from "../src/runtime.js";

describe("runtime tasking tools", () => {
  let dir: string;
  let runtime: Runtime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-runtime-"));
    runtime = new Runtime(dir);
    runtime.settings.set("vault_repo", "zenod-ai/fixture");
    runtime.settings.set("github_token", "ghp_test");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("approveQueue adds owner:agent with status:queued so queued issues are visible to the runner", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const tools = (runtime as unknown as { buildTaskingTools(): ExternalTaskingTools }).buildTaskingTools();
    const result = await tools.approveQueue({ repo: "zenod-ai/fixture", issueNumbers: [54] });

    expect(result).toBe("Queued #54 — the monitor will pick them up.");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/repos/zenod-ai/fixture/issues/54/labels/status%3Aproposed");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[1]?.url).toContain("/repos/zenod-ai/fixture/issues/54/labels");
    expect(calls[1]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      labels: ["owner:agent", "status:queued"],
    });
  });
});
