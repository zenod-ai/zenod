// @vitest-environment jsdom
// E7-S32: the Obsidian import card: pick the vault folder, see what will come in, press Import, see it landed.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

import { ApiError } from "@/lib/api"
import { ObsidianImportCard } from "./obsidian-import"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

function picked(path: string, content: string): File {
  const file = new File([content], path.split("/").at(-1)!)
  Object.defineProperty(file, "webkitRelativePath", { value: path })
  if (!("text" in file)) Object.defineProperty(file, "text", { value: async () => content })
  return file
}

const VAULT = [
  picked("Garden/Welcome.md", "---\ntags: [garden]\n---\n\nSee [[Garden plan]].\n"),
  picked("Garden/Projects/Garden plan.md", "Plant the fennel.\n"),
  picked("Garden/.obsidian/app.json", "{}"),
  picked("Garden/assets/seed.png", "png"),
]

describe("ObsidianImportCard (E7-S32)", () => {
  it("says in plain words what it does, then imports a picked vault folder in one step", async () => {
    mocks.api.mockResolvedValue({ ok: true, folder: "Imported/Garden/", written: 2, unchanged: 0, headSha: "abc" })
    const onOpenTree = vi.fn()
    render(<ObsidianImportCard onOpenTree={onOpenTree} />)
    expect(screen.getByRole("heading", { name: "Already keep notes in Obsidian?" })).toBeTruthy()
    expect(screen.getByText(/uses no AI credit/)).toBeTruthy()
    const input = screen.getByTestId("obsidian-import-folder") as HTMLInputElement
    expect(input.hasAttribute("webkitdirectory")).toBe(true)

    fireEvent.change(input, { target: { files: VAULT } })
    await waitFor(() => expect(screen.getByTestId("obsidian-import-count").textContent).toBe("2"))
    expect(screen.getByTestId("obsidian-import-name").textContent).toBe("Garden")
    expect(screen.getByText(/1 picture or other file stays out/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Import 2 notes" }))
    await waitFor(() => expect(screen.getByTestId("obsidian-import-done").textContent).toContain("2 notes from Garden are in your memory"))
    expect(mocks.api).toHaveBeenCalledWith("/api/vault/import", {
      method: "POST",
      body: {
        vaultName: "Garden",
        files: [
          { name: "Projects/Garden plan.md", content: "Plant the fennel.\n" },
          { name: "Welcome.md", content: "---\ntags: [garden]\n---\n\nSee [[Garden plan]].\n" },
        ],
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "See them in your memory" }))
    expect(onOpenTree).toHaveBeenCalled()
  })

  it("shows the server's plain reason when an import is refused", async () => {
    mocks.api.mockRejectedValue(new ApiError(409, "Your memory is busy saving something else. Try again in a minute."))
    render(<ObsidianImportCard />)
    fireEvent.change(screen.getByTestId("obsidian-import-folder"), { target: { files: VAULT } })
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 notes" }))
    expect((await screen.findByRole("alert")).textContent).toContain("busy saving something else")
  })
})
