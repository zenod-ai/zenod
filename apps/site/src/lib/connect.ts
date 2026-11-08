// Facts for the zenod.dev/connect guide (EPIC-10 R2). Directory listings link
// here, so every client step below was checked against that client's own docs
// on 2026-11-02 (sources in docs/evidence/epic10-r2-2026-11-02.md).

export const MCP_SERVER_URL = "https://cloud.zenod.dev/mcp"
export const SUPPORT_EMAIL = "support@zenod.dev"

export const ICON_URLS = {
  svg: "/brand/zenod-icon.svg",
  png512: "/brand/zenod-icon-512.png",
  png1024: "/brand/zenod-icon-1024.png",
} as const

// Cursor's documented one-click link: the config is the server entry from
// mcp.json, JSON-stringified and base64-encoded, with the name in `name`.
export const CURSOR_INSTALL_URL = `cursor://anysphere.cursor-deeplink/mcp/install?name=Zenod&config=${btoa(
  JSON.stringify({ url: MCP_SERVER_URL }),
)}`

export const CURSOR_CONFIG = JSON.stringify(
  { mcpServers: { zenod: { url: MCP_SERVER_URL } } },
  null,
  2,
)

export const VSCODE_CONFIG = JSON.stringify(
  { servers: { zenod: { type: "http", url: MCP_SERVER_URL } } },
  null,
  2,
)

export const VSCODE_COMMAND = `code --add-mcp '${JSON.stringify({ name: "zenod", type: "http", url: MCP_SERVER_URL })}'`

export const GEMINI_COMMAND = `gemini mcp add --transport http --scope user zenod ${MCP_SERVER_URL}`

// The customer memory tools. Titles match the server's tool annotations;
// E10-R1 settles the final customer surface and descriptions.
export const MEMORY_TOOLS: ReadonlyArray<{
  name: string
  title: string
  does: string
  access: "Reads" | "Writes"
}> = [
  { name: "search_memory", title: "Search memory", does: "Finds entries in your vault by words, category or date, with their paths and sources.", access: "Reads" },
  { name: "get_memory", title: "Get memory", does: "Opens one note from your vault.", access: "Reads" },
  { name: "memory_cloud", title: "Memory cloud", does: "Follows the strong links around a topic and returns the memories tied to it, strongest first.", access: "Reads" },
  { name: "ask_brain", title: "Ask the brain", does: "Answers a question across many notes and cites the vault pages it used.", access: "Reads" },
  { name: "store_memory", title: "Store memory", does: "Saves something new: keeps the original as evidence and files it onto the right page.", access: "Writes" },
  { name: "ingest_memory", title: "Ingest memory artifact", does: "Files a voice note, screenshot, PDF or link: keeps the original and files what it says onto the right pages.", access: "Writes" },
  { name: "get_ingest_result", title: "Get ingest result", does: "Reports what an ingest filed, and where.", access: "Reads" },
  { name: "get_task_result", title: "Get task result", does: "Returns the receipt of a save or ingest once it finishes: the pages touched and the saved revision.", access: "Reads" },
]

export const EXAMPLE_PROMPTS: ReadonlyArray<{ prompt: string; tool: string }> = [
  { prompt: "Remember that my car insurance with Mapfre renews on 14 March.", tool: "store_memory" },
  { prompt: "When does my passport expire?", tool: "ask_brain" },
  { prompt: "What did I send myself on WhatsApp last week about the garden?", tool: "search_memory" },
  { prompt: "Open my note on the Barcelona flat viewing.", tool: "get_memory" },
  { prompt: "File this meeting transcript into my vault.", tool: "ingest_memory" },
]
