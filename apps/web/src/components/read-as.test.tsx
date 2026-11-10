// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReadAsLine } from "./memory-chat"

afterEach(cleanup)

// EPIC-14 S29: the "Read as" line and its correction, on a made-up memory.
const FLAT = { phrase: "the flat", path: "Projects/Move.md", title: "Moving to Valencia", lineage: ["Home", "Moving to Valencia"], by: "name" as const }
const places = async () => [
  { path: "Projects/Move.md", title: "Moving to Valencia", lineage: ["Home", "Moving to Valencia"], names: ["the flat"], memories: 9 },
  { path: "Projects/Boat.md", title: "Boat", lineage: ["Boat"], names: ["the Laia"], memories: 3 },
]

describe("ReadAsLine (E14-S29)", () => {
  it("shows what the words were read as", () => {
    render(<ReadAsLine readings={[FLAT]} loadPlaces={places} save={vi.fn()} />)
    expect(screen.getByTestId("memory-read-as").textContent).toBe("Read as: “the flat” → Home › Moving to Valencia")
  })

  it("a tap lets you pick the place you meant, and saves it", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<ReadAsLine readings={[FLAT]} loadPlaces={places} save={save} />)
    fireEvent.click(screen.getByRole("button", { name: /the flat/ }))
    fireEvent.change(await screen.findByPlaceholderText("Find a place in your memory"), { target: { value: "laia" } })
    fireEvent.click(await screen.findByRole("button", { name: /Boat/ }))
    await screen.findByRole("status")
    expect(save).toHaveBeenCalledWith("the flat", "Projects/Boat.md")
    expect(screen.getByTestId("memory-read-as").textContent).toContain("“the flat” → Boat")
    expect(screen.getByRole("status").textContent).toContain("Zenod will read “the flat” this way from now on")
  })

  it("None of these keeps the words from being read as a place", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<ReadAsLine readings={[FLAT]} loadPlaces={places} save={save} />)
    fireEvent.click(screen.getByRole("button", { name: /the flat/ }))
    fireEvent.click(await screen.findByRole("button", { name: /None of these/ }))
    await screen.findByRole("status")
    expect(save).toHaveBeenCalledWith("the flat", null)
    expect(screen.getByTestId("memory-read-as").textContent).toContain("not a place")
  })
})
