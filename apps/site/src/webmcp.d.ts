// Minimal WebMCP typing (Chrome, Oct 2026). `navigator.modelContext` is the deprecated alias.
interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  consequentialHint?: boolean
}

interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (
    args: Record<string, unknown>,
    context: { signal?: AbortSignal },
  ) => Promise<unknown>
  annotations?: WebMcpToolAnnotations
}

interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<unknown> | unknown
}

interface Document {
  modelContext?: WebMcpModelContext
}

interface Navigator {
  /** @deprecated use document.modelContext */
  modelContext?: WebMcpModelContext
}
