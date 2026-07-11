import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PEER_SKILL_LIMITS, PeerSkillStore } from "../src/peerSkillStore.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function skill(version = "1.0.0") {
  return [
    {
      path: "SKILL.md",
      content: `---\nname: callisthenes\ndescription: Safely use a connected outbound peer.\nmetadata:\n  version: "${version}"\n---\n\n# Callisthenes\n`,
    },
    { path: "references/WORKFLOW.md", content: "# Workflow\nDraft, confirm, publish.\n" },
    { path: "references/EXAMPLES.md", content: "# Examples\nNo credentials.\n" },
    { path: "scripts/ignored.sh", content: "#!/bin/sh\nexit 99\n" },
  ];
}

describe("PeerSkillStore", () => {
  it("stores immutable content-addressed bundles with safe references and inert scripts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "peer-skills-"));
    dirs.push(dataDir);
    const store = new PeerSkillStore(dataDir);

    const first = await store.put(skill());
    const duplicate = await store.put(skill());
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      artifactId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      version: "1.0.0",
      name: "callisthenes",
      scriptsInert: true,
      files: expect.arrayContaining([
        expect.objectContaining({ path: "references/WORKFLOW.md", executable: false }),
        expect.objectContaining({ path: "scripts/ignored.sh", executable: false }),
      ]),
    });

    const download = await store.download(first);
    expect(download.format).toBe("zenod-agent-skill-bundle-v1");
    expect(Buffer.from(download.files.find((file) => file.path === "references/WORKFLOW.md")!.contentBase64, "base64").toString())
      .toContain("Draft, confirm, publish");

    const digest = first.artifactId.slice("sha256:".length);
    expect(await readFile(join(store.rootDir, digest, "files", "scripts", "ignored.sh"), "utf8"))
      .toContain("exit 99");

    const replacement = await store.put(skill("2.0.0"));
    expect(replacement.artifactId).not.toBe(first.artifactId);
    expect((await store.download(first)).artifact.version).toBe("1.0.0");
  });

  it.each([
    [{ path: "../escape.md", content: "no" }],
    [{ path: "/absolute.md", content: "no" }],
    [{ path: "references\\escape.md", content: "no" }],
    [{ path: "linked", content: "no", kind: "symlink" as const }],
  ])("rejects unsafe and non-regular entries", async (entry) => {
    const dataDir = await mkdtemp(join(tmpdir(), "peer-skills-reject-"));
    dirs.push(dataDir);
    const store = new PeerSkillStore(dataDir);
    await expect(store.put([...skill(), entry])).rejects.toThrow();
  });

  it("rejects missing or malformed required manifests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "peer-skills-manifest-"));
    dirs.push(dataDir);
    const store = new PeerSkillStore(dataDir);
    await expect(store.put([{ path: "README.md", content: "hello" }])).rejects.toThrow("requires SKILL.md");
    await expect(store.put([{ path: "SKILL.md", content: "---\nname: incomplete\n---\n" }]))
      .rejects.toThrow("name and description");
  });

  it("rejects files and bundles over their configured limits", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "peer-skills-size-"));
    dirs.push(dataDir);
    const store = new PeerSkillStore(dataDir);
    await expect(store.put([
      ...skill(),
      { path: "assets/oversized.bin", content: "x".repeat(PEER_SKILL_LIMITS.maxFileBytes + 1) },
    ])).rejects.toThrow("too large");
    await expect(store.put(Array.from({ length: PEER_SKILL_LIMITS.maxFiles + 1 }, (_, index) => ({
      path: index === 0 ? "SKILL.md" : `references/${index}.md`,
      content: index === 0 ? skill()[0]!.content : "x",
    })))).rejects.toThrow("too many files");
  });

  it("enforces the tenant artifact quota across concurrent immutable versions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "peer-skills-quota-"));
    dirs.push(dataDir);
    const store = new PeerSkillStore(dataDir);
    const results = await Promise.allSettled(Array.from(
      { length: PEER_SKILL_LIMITS.maxArtifactsPerTenant + 1 },
      (_, index) => store.put(skill(`${index}.0.0`)),
    ));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(PEER_SKILL_LIMITS.maxArtifactsPerTenant);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ message: "Tenant peer skill artifact quota exceeded." });
  });
});
