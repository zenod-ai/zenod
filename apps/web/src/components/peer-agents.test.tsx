// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Peer, PeerSkill } from "./peer-agents-model"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "error",
}))
vi.mock("sonner", () => ({ toast: mocks.toast }))

import { PeerAgents } from "./peer-agents"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function peer(overrides: Partial<Peer> = {}): Peer {
  return {
    name: "Calli",
    url: "https://calli.example/mcp",
    hasToken: true,
    transportStatus: "connected",
    toolsStatus: "ready",
    toolCount: 1,
    tools: [{ name: "calli__search_chats", mcpName: "search_chats" }],
    skill: null,
    ...overrides,
  }
}

function skill(version: string): PeerSkill {
  return {
    artifactId: `sha256:${version}`,
    version,
    name: "callisthenes",
    description: "Portable Calli instructions.",
    createdAt: "2026-07-11T00:00:00Z",
    totalBytes: 42,
    files: [{ path: "SKILL.md", size: 42, sha256: "abc", executable: false }],
    scriptsInert: true,
  }
}

function bundle(version: string) {
  return new File(
    [
      JSON.stringify({
        format: "zenod-agent-skill-bundle-v1",
        artifact: { name: "callisthenes", version },
        files: [{ path: "SKILL.md", contentBase64: "IyBDYWxsaQ==" }],
      }),
    ],
    `calli-${version}.skill.json`,
    { type: "application/json" }
  )
}

beforeEach(() => {
  mocks.api.mockReset()
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
  mocks.toast.warning.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("PeerAgents", () => {
  it("renders transport and tool errors independently without a synthetic tool or token", async () => {
    mocks.api.mockResolvedValueOnce({
      peers: [
        peer({
          toolsStatus: "error",
          toolsError: "tools/list timed out",
          toolCount: 0,
          tools: [],
        }),
      ],
    })

    render(<PeerAgents />)

    expect(await screen.findByText("transport connected")).toBeTruthy()
    expect(screen.getByText("tools unavailable")).toBeTruthy()
    expect(screen.getByText("tools/list timed out")).toBeTruthy()
    expect(document.body.textContent).not.toContain("ask_calli")
    expect(document.body.textContent).not.toContain("downstream-secret")
  })

  it("reports a saved unit truthfully when discovery fails", async () => {
    const user = userEvent.setup()
    mocks.api.mockResolvedValueOnce({ peers: [] }).mockResolvedValueOnce({
      peers: [
        peer({
          transportStatus: "error",
          toolsStatus: "error",
          toolsError: "unauthorized",
          toolCount: 0,
          tools: [],
        }),
      ],
    })
    render(<PeerAgents />)
    await screen.findByText("No units yet")

    await user.type(screen.getByLabelText("Unit name"), "Calli")
    await user.type(
      screen.getByLabelText("MCP URL"),
      "https://calli.example/mcp"
    )
    await user.type(screen.getByLabelText("Bearer token"), "downstream-secret")
    await user.click(screen.getByRole("button", { name: "Add unit" }))

    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        'Unit "Calli" saved, but tools are unavailable',
        { description: "unauthorized" }
      )
    )
    expect(mocks.toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining("connected"),
      expect.anything()
    )
    expect(
      (screen.getByLabelText("Bearer token") as HTMLInputElement).value
    ).toBe("")
    expect(document.body.textContent).not.toContain("downstream-secret")
  })

  it("refreshes one peer, surfaces errors, and ignores an older response that resolves last", async () => {
    const first = deferred<{ peers: Peer[] }>()
    const second = deferred<{ peers: Peer[] }>()
    mocks.api
      .mockResolvedValueOnce({
        peers: [
          peer({
            toolsStatus: "error",
            toolsError: "old error",
            toolCount: 0,
            tools: [],
          }),
        ],
      })
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    render(<PeerAgents />)
    const refresh = await screen.findByRole("button", { name: "Refresh tools" })

    fireEvent.click(refresh)
    fireEvent.click(refresh)
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/peers/refresh", {
      method: "POST",
      body: { name: "Calli" },
    })
    expect(mocks.api).toHaveBeenNthCalledWith(3, "/api/peers/refresh", {
      method: "POST",
      body: { name: "Calli" },
    })

    second.resolve({
      peers: [peer({ tools: [{ name: "calli__new", mcpName: "new" }] })],
    })
    expect(await screen.findByText(/calli__new/)).toBeTruthy()
    first.resolve({
      peers: [peer({ tools: [{ name: "calli__stale", mcpName: "stale" }] })],
    })
    await waitFor(() => expect(screen.queryByText(/calli__stale/)).toBeNull())

    mocks.api.mockRejectedValueOnce(new Error("refresh exploded"))
    fireEvent.click(screen.getByRole("button", { name: "Refresh tools" }))
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Could not refresh tools for Calli",
        { description: "refresh exploded" }
      )
    )
  })

  it("wires attach, replace, download, and detach while locking conflicting actions", async () => {
    const user = userEvent.setup()
    const attached = deferred<{ attachment: PeerSkill }>()
    mocks.api
      .mockResolvedValueOnce({ peers: [peer()] })
      .mockImplementationOnce(() => attached.promise)
      .mockResolvedValueOnce({ attachment: skill("2.0.0") })
      .mockResolvedValueOnce({ attachment: null })
    render(<PeerAgents />)
    const input = await screen.findByLabelText("Choose Agent Skill for Calli")

    await user.upload(input, bundle("1.0.0"))
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh tools",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole("button", {
          name: "Attach skill",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      "/api/peers/Calli/skill",
      expect.objectContaining({ method: "PUT" })
    )
    attached.resolve({ attachment: skill("1.0.0") })
    expect(await screen.findByText("v1.0.0")).toBeTruthy()

    await user.upload(input, bundle("2.0.0"))
    expect(await screen.findByText("v2.0.0")).toBeTruthy()

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    const createObjectURL = vi.fn(() => "blob:skill")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-disposition":
                'attachment; filename="calli-2.skill.json"',
            },
          })
      )
    )
    await user.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:skill")

    await user.click(screen.getByRole("button", { name: "Detach" }))
    expect(await screen.findByText("No Agent Skill attached")).toBeTruthy()
    expect(mocks.api).toHaveBeenLastCalledWith("/api/peers/Calli/skill", {
      method: "DELETE",
    })
  })
})
