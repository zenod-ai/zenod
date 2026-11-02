import { describe, expect, it, vi } from "vitest"

import {
  DOCS_URL,
  GOOGLE_SIGN_IN_PATH,
  PRICING_OPTIONS,
  SIGN_IN_PATH,
} from "./customer"
import { registerWebMcpTools } from "./webmcp"

function setup() {
  const tools = new Map<string, WebMcpTool>()
  const registerTool = vi.fn<WebMcpModelContext["registerTool"]>(async (tool) => {
    tools.set(tool.name, tool)
  })
  const navigate = vi.fn()
  const controller = new AbortController()
  registerWebMcpTools(controller.signal, navigate, { modelContext: { registerTool } })
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await tools.get(name)!.execute(args, {})) as {
      content: { text: string }[]
    }
    return JSON.parse(result.content[0].text)
  }
  return { tools, registerTool, navigate, controller, run }
}

describe("WebMCP tools", () => {
  it("registers the four tools with the abort signal", () => {
    const { tools, registerTool, controller } = setup()
    expect([...tools.keys()].sort()).toEqual(
      ["describe_zenod", "get_plans", "go_to_sign_in", "open_docs"],
    )
    expect(registerTool.mock.calls[0][1]).toEqual({ signal: controller.signal })
    expect(tools.get("describe_zenod")!.annotations?.readOnlyHint).toBe(true)
    expect(tools.get("get_plans")!.annotations?.readOnlyHint).toBe(true)
    expect(tools.get("go_to_sign_in")!.annotations?.consequentialHint).toBe(true)
  })

  it("describes Zenod in the site's own words", async () => {
    const { run } = setup()
    const out = await run("describe_zenod")
    expect(out.description).toMatch(/AI memory agent for your personal library/)
  })

  it("returns plans from the pricing data", async () => {
    const { run } = setup()
    const out = await run("get_plans")
    expect(out.plans).toEqual(
      PRICING_OPTIONS.map(({ name, price, cadence, description }) => ({ name, price, cadence, description })),
    )
    expect(JSON.stringify(out)).toContain("€9")
  })

  it("opens the docs", async () => {
    const { run, navigate } = setup()
    expect((await run("open_docs")).url).toBe(DOCS_URL)
    expect(navigate).toHaveBeenCalledWith(DOCS_URL)
  })

  it("navigates to sign-in only, per provider", async () => {
    const { run, navigate } = setup()
    await run("go_to_sign_in")
    expect(navigate).toHaveBeenLastCalledWith(GOOGLE_SIGN_IN_PATH)
    await run("go_to_sign_in", { provider: "github" })
    expect(navigate).toHaveBeenLastCalledWith(SIGN_IN_PATH)
    await expect(run("go_to_sign_in", { provider: "email" })).rejects.toThrow()
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it("falls back to the deprecated navigator.modelContext", () => {
    const registerTool = vi.fn<WebMcpModelContext["registerTool"]>(async () => {})
    registerWebMcpTools(new AbortController().signal, vi.fn(), {}, {
      modelContext: { registerTool },
    })
    expect(registerTool).toHaveBeenCalledTimes(4)
  })

  it("does nothing, without throwing, when modelContext is missing", () => {
    expect(() =>
      registerWebMcpTools(new AbortController().signal, vi.fn(), {}, {}),
    ).not.toThrow()
    expect(() => registerWebMcpTools(new AbortController().signal)).not.toThrow()
  })
})
