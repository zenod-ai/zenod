// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  chatStream: vi.fn(),
  notConfigured: false,
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  chatStream: mocks.chatStream,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "error",
  isNotConfigured: () => mocks.notConfigured,
  transcribeVoiceNote: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: mocks.toast }))

import { HeraldLoopPanels } from "./herald-loop-panels"
import { ChatTab } from "@/views/ChatTab"

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.api.mockReset()
  mocks.chatStream.mockReset()
  mocks.notConfigured = false
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
})

afterEach(() => cleanup())

describe("Herald loop dashboard", () => {
  it("shows approved briefing and board WHY/citation/permalink, and Run now uses the scheduler API", async () => {
    const refresh = vi.fn()
    window.addEventListener("herald:chat-refresh", refresh)
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/herald/briefing")
        return {
          briefing: {
            version: 2,
            content: {
              theme: "launch",
              objectives: ["show proof"],
              tone: "direct",
              replyPolicy: "few",
            },
            cadenceMinutes: 30,
            proposalCount: 3,
            approvedAt: 1,
          },
        }
      if (path === "/api/herald/board")
        return {
          items: [
            {
              id: "item-1",
              state: "posted",
              text: "The launch is alive.",
              rationale: "Builds on the shipped customer journey.",
              memoryCitation:
                "https://github.com/acme/brain/blob/main/Launch.md",
              permalink: "https://x.com/i/web/status/123",
            },
          ],
          wakes: [],
        }
      if (path === "/api/herald/run-now")
        return {
          code: "wake_completed",
          message: "Herald wake completed.",
          completedAt: 2,
        }
      throw new Error(`unexpected ${path}`)
    })

    render(<HeraldLoopPanels />)
    expect(await screen.findByText("Chat, Briefing, and Board are three views of the same Herald state.")).toBeTruthy()
    expect(await screen.findByText("The launch is alive.")).toBeTruthy()
    expect(screen.getByText(/WHY:/)).toBeTruthy()
    expect(screen.getByText("Memory citation").closest("a")?.href).toContain(
      "Launch.md"
    )
    expect(screen.getByText(/x.com\/i\/web\/status\/123/)).toBeTruthy()
    expect(screen.getByText("v2 · approved")).toBeTruthy()
    expect(screen.getByText(/Automated X replies are not active yet/)).toBeTruthy()

    await userEvent.click(screen.getByRole("button", { name: "Run now" }))
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/herald/run-now", {
        method: "POST",
      })
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    window.removeEventListener("herald:chat-refresh", refresh)
  })

  it("shows the structural no-briefing gate", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path.endsWith("briefing") ? { briefing: null } : { items: [], wakes: [] }
    )
    render(<HeraldLoopPanels />)
    expect(
      await screen.findByText("No briefing approved — Herald will not loop.")
    ).toBeTruthy()
  })
})

describe("Herald chat receipt refresh", () => {
  it("uses Herald-only conversation and configuration language", async () => {
    mocks.api.mockResolvedValueOnce({ messages: [] })
    mocks.notConfigured = true
    mocks.chatStream.mockRejectedValueOnce(new Error("not configured"))
    render(<ChatTab vaultless product="herald" />)

    expect(await screen.findByText("Talk with Herald")).toBeTruthy()
    expect(screen.getByText(/review the same numbered Board items/)).toBeTruthy()
    await userEvent.type(screen.getByPlaceholderText("Message Herald about the briefing or current Board…"), "hello")
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(await screen.findByText("Herald needs a model key before he can reply. Add it in Keys.")).toBeTruthy()
    expect(document.body.textContent).not.toContain("Zenod is not fully configured")
  })

  it("reloads persisted chat only for the Herald refresh event", async () => {
    mocks.api
      .mockResolvedValueOnce({
        messages: [{ role: "assistant", text: "Before wake" }],
      })
      .mockResolvedValueOnce({
        messages: [
          {
            role: "assistant",
            text: "Proposal 1 with WHY and memory citation",
          },
        ],
      })
    render(<ChatTab vaultless />)
    expect(await screen.findByText("Before wake")).toBeTruthy()
    window.dispatchEvent(new CustomEvent("herald:chat-refresh"))
    expect(
      await screen.findByText("Proposal 1 with WHY and memory citation")
    ).toBeTruthy()
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })
})
