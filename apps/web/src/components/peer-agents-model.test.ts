import { describe, expect, it } from "vitest"

import {
  isCurrentOperation,
  nextOperationGeneration,
  peerFromResponse,
  replacePeer,
  setPeerSkill,
  skillFilesFromSelection,
  type Peer,
} from "./peer-agents-model"

const peer = (overrides: Partial<Peer> = {}): Peer => ({
  name: "Calli",
  url: "https://calli.example/mcp",
  hasToken: true,
  transportStatus: "connected",
  toolsStatus: "ready",
  toolCount: 0,
  tools: [],
  skill: null,
  ...overrides,
})

describe("peer wallet UI model", () => {
  it("keeps transport connectivity separate from a catalog error", () => {
    const value = peer({
      toolsStatus: "error",
      toolsError: "tools/list timed out",
    })
    expect(value.transportStatus).toBe("connected")
    expect(value.toolsStatus).toBe("error")
    expect(value.toolsError).toBe("tools/list timed out")
  })

  it("represents ready catalogs with zero or many real tool names", () => {
    const empty = peer()
    const ready = peer({
      toolCount: 2,
      tools: [
        { name: "calli__send_email", mcpName: "send_email" },
        { name: "calli__search_chats", mcpName: "search_chats" },
      ],
    })
    expect(empty).toMatchObject({
      toolsStatus: "ready",
      toolCount: 0,
      tools: [],
    })
    expect(ready.tools.map((tool) => tool.name)).toEqual([
      "calli__send_email",
      "calli__search_chats",
    ])
    expect(JSON.stringify(ready)).not.toContain("ask_calli")
  })

  it("ignores an older per-peer response after a newer operation starts", () => {
    const generations = new Map<string, number>()
    const oldRefresh = nextOperationGeneration(generations, "Calli")
    const newRefresh = nextOperationGeneration(generations, "Calli")
    expect(isCurrentOperation(generations, "Calli", oldRefresh)).toBe(false)
    expect(isCurrentOperation(generations, "Calli", newRefresh)).toBe(true)
  })

  it("updates only the named peer when refresh returns the complete wallet", () => {
    const zenod = peer({ name: "Zenod" })
    const calli = peer({ toolsStatus: "error", toolsError: "old" })
    const refreshedCalli = peer({
      toolCount: 1,
      tools: [{ name: "calli__send", mcpName: "send" }],
    })
    expect(peerFromResponse([zenod, refreshedCalli], "Calli")).toEqual(
      refreshedCalli
    )
    expect(replacePeer([zenod, calli], refreshedCalli)).toEqual([
      zenod,
      refreshedCalli,
    ])
  })

  it("preserves token absence as display-only state", () => {
    const value = peer({ hasToken: false })
    expect(value.hasToken).toBe(false)
    expect(value).not.toHaveProperty("token")
  })

  it("attaches, replaces, and detaches skill metadata without changing peer connectivity", () => {
    const first = {
      artifactId: "sha256:first",
      version: "1.0.0",
      name: "calli",
      description: "Calli instructions",
      createdAt: "2026-07-11T00:00:00Z",
      totalBytes: 10,
      files: [],
      scriptsInert: true as const,
    }
    const second = { ...first, artifactId: "sha256:second", version: "2.0.0" }
    const attached = setPeerSkill([peer()], "Calli", first)
    const replaced = setPeerSkill(attached, "Calli", second)
    const detached = setPeerSkill(replaced, "Calli", null)

    expect(attached[0]).toMatchObject({
      transportStatus: "connected",
      skill: { artifactId: "sha256:first", version: "1.0.0" },
    })
    expect(replaced[0]?.skill).toMatchObject({
      artifactId: "sha256:second",
      version: "2.0.0",
    })
    expect(detached[0]).toMatchObject({
      transportStatus: "connected",
      skill: null,
    })
  })

  it("accepts the downloaded bundle format for attach and replace", async () => {
    const bundle = new File(
      [
        JSON.stringify({
          format: "zenod-agent-skill-bundle-v1",
          artifact: { name: "calli", version: "2" },
          files: [{ path: "SKILL.md", contentBase64: "IyBDYWxsaQ==" }],
        }),
      ],
      "calli.skill.json",
      { type: "application/json" }
    )
    await expect(skillFilesFromSelection([bundle])).resolves.toEqual([
      { path: "SKILL.md", contentBase64: "IyBDYWxsaQ==" },
    ])
  })

  it("rejects unrelated JSON instead of uploading an ambiguous artifact", async () => {
    const file = new File(["{}"], "not-a-skill.json", {
      type: "application/json",
    })
    await expect(skillFilesFromSelection([file])).rejects.toThrow(".skill.json")
  })
})
