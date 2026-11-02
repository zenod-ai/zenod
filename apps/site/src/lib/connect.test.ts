import { describe, expect, it } from "vitest"

import { DOCS_URL } from "./customer"
import {
  CURSOR_INSTALL_URL,
  GEMINI_COMMAND,
  MCP_SERVER_URL,
  MEMORY_TOOLS,
  VSCODE_COMMAND,
  VSCODE_CONFIG,
} from "./connect"

describe("connect guide", () => {
  it("is where the site's docs link points", () => {
    expect(DOCS_URL).toBe("https://zenod.dev/connect")
  })

  it("builds Cursor's documented install link from the server entry", () => {
    const url = new URL(CURSOR_INSTALL_URL)
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("cursor://anysphere.cursor-deeplink/mcp/install")
    expect(url.searchParams.get("name")).toBe("Zenod")
    expect(JSON.parse(atob(url.searchParams.get("config")!))).toEqual({ url: MCP_SERVER_URL })
  })

  it("uses the hosted streamable HTTP endpoint in every client snippet", () => {
    expect(MCP_SERVER_URL).toBe("https://cloud.zenod.dev/mcp")
    expect(JSON.parse(VSCODE_CONFIG)).toEqual({ servers: { zenod: { type: "http", url: MCP_SERVER_URL } } })
    expect(VSCODE_COMMAND).toContain(`"type":"http","url":"${MCP_SERVER_URL}"`)
    expect(GEMINI_COMMAND).toBe(`gemini mcp add --transport http --scope user zenod ${MCP_SERVER_URL}`)
  })

  it("lists only the seven customer memory tools", () => {
    expect(MEMORY_TOOLS.map((tool) => tool.name)).toEqual([
      "search_memory",
      "get_memory",
      "ask_brain",
      "store_memory",
      "ingest_memory",
      "get_ingest_result",
      "get_task_result",
    ])
  })

})
