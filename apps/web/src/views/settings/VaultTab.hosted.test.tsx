// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app#vault"}

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

vi.mock("@/components/github-connect", () => ({
  GithubConnect: () => <div>GitHub repository setup</div>,
}))

import { VaultTab } from "./VaultTab"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  window.history.replaceState(null, "", "/app#vault")
})

const vaultStatus = {
  repo: null,
  branch: "main",
  vaultConfigured: false,
  configured: true,
  provider: "openrouter",
  llmReady: true,
  cloned: false,
  headSha: null,
  cloneError: null,
}

function projection(
  provider: "github" | "google_drive" | null,
  blocker:
    | "vault_not_selected"
    | "vault_authorization_required"
    | "vault_recovering"
    | "vault_conflict"
    | "vault_error"
    | null
) {
  const ready = blocker === null && provider !== null
  return {
    provider,
    ready,
    memory: {
      store: ready,
      search: ready,
      get: ready,
      ask: ready,
      attachments: ready,
    },
    githubTasking: false,
    blocker,
  }
}

function mockHostedVault(
  state: ReturnType<typeof projection>,
  providers: Array<"github" | "google"> = ["google"]
) {
  mocks.api.mockImplementation((path: string) => {
    if (path === "/api/vault")
      return Promise.resolve({
        ...vaultStatus,
        vaultConfigured: state.provider !== null,
        cloned: state.ready,
        headSha: state.ready ? "1234567890abcdef" : null,
      })
    if (path === "/api/vault/provider") return Promise.resolve(state)
    if (path === "/api/me") return Promise.resolve({ providers })
    return Promise.reject(new Error(`Unexpected API call: ${path}`))
  })
}

describe("Hosted authoritative vault onboarding", () => {
  it("lets a Google-only customer select Drive without requiring GitHub", async () => {
    mockHostedVault(projection(null, "vault_not_selected"))

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(
      await screen.findByText("Choose where Zenod keeps your vault")
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Use Google Drive" })
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Connect GitHub identity" })
    ).not.toBeNull()
    expect(screen.getByText(/same Markdown memory experience/i)).not.toBeNull()
    expect(screen.queryByText(/Vault not configured/i)).toBeNull()
  })

  it("shows a ready Drive vault with refresh, external access, and real Git HEAD", async () => {
    mockHostedVault(projection("google_drive", null))

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(await screen.findByText(/ordinary Markdown files/i)).not.toBeNull()
    expect(screen.getByText("1234567890")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Refresh from Drive" })
    ).not.toBeNull()
    expect(
      screen
        .getByRole("link", { name: /Open Google Drive/i })
        .getAttribute("href")
    ).toBe("https://drive.google.com/drive/my-drive")
    expect(screen.getByText(/never deletes your Drive files/i)).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /Re-clone|clones the repository again from GitHub/i
    )
  })

  it("makes conflict and revoked-consent states actionable", async () => {
    mockHostedVault(projection("google_drive", "vault_conflict"))
    const { unmount } = render(
      <VaultTab edition="hosted" allowReclone={false} />
    )

    expect(
      await screen.findByText("Drive conflict needs review")
    ).not.toBeNull()
    const recover = screen.getByRole("button", { name: "Retry recovery" })
    expect(
      screen.getByRole("link", { name: /Open Google Drive/i })
    ).not.toBeNull()
    mocks.api.mockResolvedValueOnce({ ok: true })
    fireEvent.click(recover)
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/vault/drive/recover", {
        method: "POST",
      })
    })

    unmount()
    mockHostedVault(projection("google_drive", "vault_authorization_required"))
    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(await screen.findByText("Reconnect Google Drive")).not.toBeNull()
    const reconnect = screen.getByRole("button", { name: "Reconnect Drive" })
    mocks.api.mockResolvedValueOnce({ url: "https://invalid.example/blocked" })
    fireEvent.click(reconnect)
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/vault/drive/oauth/start", {
        method: "POST",
        body: { intent: "connect_drive_vault" },
      })
    })
  })

  it("keeps a legacy configured GitHub vault on its existing path", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/vault")
        return Promise.resolve({
          ...vaultStatus,
          repo: "octocat/brain",
          vaultConfigured: true,
          cloned: true,
          headSha: "abcdef123456",
        })
      if (path === "/api/vault/provider")
        return Promise.resolve(projection(null, "vault_not_selected"))
      if (path === "/api/me") return Promise.resolve({ providers: ["github"] })
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(await screen.findByText("GitHub repository setup")).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: "Use Google Drive" })
    ).toBeNull()
    expect(screen.queryByText("Choose where Zenod keeps your vault")).toBeNull()
    expect(screen.getByText(/GitHub is the durable authority/i)).not.toBeNull()
  })

  it.each([
    ["vault_authorization_required", "Reconnect GitHub"],
    ["vault_recovering", "Preparing your GitHub vault"],
    ["vault_conflict", "GitHub vault conflict needs review"],
    ["vault_error", "GitHub vault needs attention"],
  ] as const)(
    "keeps GitHub %s recovery on GitHub actions and copy",
    async (blocker, title) => {
      mockHostedVault(projection("github", blocker), ["github"])

      render(<VaultTab edition="hosted" allowReclone={false} />)

      expect(await screen.findByText(title)).not.toBeNull()
      expect(screen.getByText("GitHub repository setup")).not.toBeNull()
      expect(document.body.textContent).not.toMatch(
        /Drive permission|Retry recovery|Reconnect Drive|Drive conflict/i
      )
    }
  )

  it("does not claim Ready when a bound Drive repository has not verified", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/vault")
        return Promise.resolve({
          ...vaultStatus,
          vaultConfigured: true,
          cloned: false,
          cloneError: "Repository bundle could not be opened",
        })
      if (path === "/api/vault/provider")
        return Promise.resolve(projection("google_drive", null))
      if (path === "/api/me") return Promise.resolve({ providers: ["google"] })
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(await screen.findByText("Drive vault needs recovery")).not.toBeNull()
    expect(
      screen.getByText(/Repository bundle could not be opened/i)
    ).not.toBeNull()
    expect(screen.queryByText("Ready")).toBeNull()
    expect(screen.queryByText("Memory readiness")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Retry recovery" })
    ).not.toBeNull()
  })

  it("turns a denied Drive callback into an actionable vault retry journey", async () => {
    window.history.replaceState(null, "", "/app?vault=drive_denied#vault")
    mockHostedVault(projection(null, "vault_not_selected"))

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(
      await screen.findByText("Google Drive permission was not granted")
    ).not.toBeNull()
    expect(document.body.textContent).toMatch(/Nothing changed/i)
    expect(
      screen.getByRole("button", { name: "Use Google Drive" })
    ).not.toBeNull()
  })

  it("turns an expired Drive callback into a fresh setup journey", async () => {
    window.history.replaceState(null, "", "/app?vault=drive_expired#vault")
    mockHostedVault(projection(null, "vault_not_selected"))

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(
      await screen.findByText("Google Drive setup link expired")
    ).not.toBeNull()
    expect(document.body.textContent).toMatch(/fresh, secure setup/i)
    expect(
      screen.getByRole("button", { name: "Use Google Drive" })
    ).not.toBeNull()
  })

  it.each([
    "drive_tenant",
    "drive_config",
    "drive_exchange",
    "drive_bootstrap",
  ])("turns %s into an actionable recovery journey", async (callbackError) => {
    window.history.replaceState(null, "", `/app?vault=${callbackError}#vault`)
    mockHostedVault(projection("google_drive", "vault_error"))

    render(<VaultTab edition="hosted" allowReclone={false} />)

    expect(
      await screen.findByText("Google Drive setup needs attention")
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Reconnect Drive" })
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Retry recovery" })
    ).not.toBeNull()
  })
})
