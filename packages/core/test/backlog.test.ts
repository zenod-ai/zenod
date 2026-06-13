import { afterEach, describe, expect, it, vi } from "vitest";
import { orderBacklogItems, selectBacklog, type BacklogItem } from "../src/backlog.js";

describe("selectBacklog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  it("returns only open agent-owned queued issues, excluding archived issues and pull requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          issue(26, "Ready", ["owner:agent", "status:queued"]),
          issue(25, "Ready earlier", ["status:queued", "owner:agent"]),
          issue(37, "Archived", ["owner:agent", "status:queued", "archived"]),
          issue(38, "Human-owned", ["owner:human", "status:queued"]),
          issue(39, "Not queued", ["owner:agent", "status:blocked"]),
          { ...issue(40, "PR", ["owner:agent", "status:queued"]), pull_request: { url: "https://api.github.test/pr/40" } },
        ]),
        { status: 200 },
      ),
    );

    await expect(selectBacklog("zenod-ai/zenod")).resolves.toEqual({
      ready: [
        { number: 25, title: "Ready earlier", labels: ["status:queued", "owner:agent"], url: "https://github.com/zenod-ai/zenod/issues/25" },
        { number: 26, title: "Ready", labels: ["owner:agent", "status:queued"], url: "https://github.com/zenod-ai/zenod/issues/26" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("labels=owner%3Aagent%2Cstatus%3Aqueued");
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("uses a token when one is configured", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await selectBacklog("zenod-ai/zenod");

    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer ghp_test",
    });
  });

  it("orders by issue number by default", () => {
    const items: BacklogItem[] = [
      { number: 9, title: "Default", labels: ["owner:agent", "status:queued"], url: "" },
      { number: 10, title: "P2", labels: ["owner:agent", "status:queued", "priority:p2"], url: "" },
      { number: 2, title: "P0", labels: ["owner:agent", "status:queued", "priority:p0"], url: "" },
      { number: 1, title: "Default earlier", labels: ["owner:agent", "status:queued"], url: "" },
    ];

    expect(orderBacklogItems(items).map((item) => item.number)).toEqual([1, 2, 9, 10]);
  });

  it("allows priority-aware ordering through an explicit hook", () => {
    const items: BacklogItem[] = [
      { number: 9, title: "Default", labels: ["owner:agent", "status:queued"], url: "" },
      { number: 10, title: "P2", labels: ["owner:agent", "status:queued", "priority:p2"], url: "" },
      { number: 2, title: "P0", labels: ["owner:agent", "status:queued", "priority:p0"], url: "" },
      { number: 1, title: "Default earlier", labels: ["owner:agent", "status:queued"], url: "" },
    ];

    const rankPriority = (item: BacklogItem) => {
      const label = item.labels.find((candidate) => /^priority:p[0-9]+$/i.test(candidate));
      return label ? Number(label.split(":p")[1]) : Number.MAX_SAFE_INTEGER;
    };

    expect(orderBacklogItems(items, rankPriority).map((item) => item.number)).toEqual([2, 10, 1, 9]);
  });

  it("rejects repo names outside owner/name form", async () => {
    await expect(selectBacklog("zenod")).rejects.toThrow(/owner\/name/);
    await expect(selectBacklog("zenod-ai/zenod/extra")).rejects.toThrow(/owner\/name/);
  });
});

function issue(number: number, title: string, labels: string[]) {
  return {
    number,
    title,
    html_url: `https://github.com/zenod-ai/zenod/issues/${number}`,
    labels: labels.map((name) => ({ name })),
  };
}
