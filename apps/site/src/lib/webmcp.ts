import {
  DOCS_URL,
  GOOGLE_SIGN_IN_PATH,
  PRICING_OPTIONS,
  SIGN_IN_PATH,
} from "@/lib/customer"

// Registers read-only information tools plus two navigation tools (docs, sign-in)
// so an AI agent in the visitor's browser need not scrape the page. Every fact
// comes from the same constants the page renders.

const SITE_DESCRIPTION =
  "Zenod is the AI memory agent for your personal library. Your agents share one memory, and it stays totally yours, in ordinary Markdown in a GitHub vault (or, on Hosted, a Google Drive vault)."

const SIGN_IN_PROVIDER_PATHS = {
  google: GOOGLE_SIGN_IN_PATH,
  github: SIGN_IN_PATH,
} as const

type SignInProvider = keyof typeof SIGN_IN_PROVIDER_PATHS

type Navigate = (url: string) => void

const text = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
})

export function buildWebMcpTools(navigate: Navigate): WebMcpTool[] {
  return [
    {
      name: "describe_zenod",
      description: "Explain what Zenod is and where its memory is stored.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => text({ name: "Zenod", description: SITE_DESCRIPTION }),
    },
    {
      name: "get_plans",
      description:
        "List the Zenod editions: self-hosted (free) and Zenod Hosted, with price and what each includes.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () =>
        text({
          plans: PRICING_OPTIONS.map(({ name, price, cadence, description }) => ({
            name,
            price,
            cadence,
            description,
          })),
        }),
    },
    {
      name: "open_docs",
      description: "Open the Zenod documentation in the visitor's browser and return its URL.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        navigate(DOCS_URL)
        return text({ url: DOCS_URL })
      },
    },
    {
      name: "go_to_sign_in",
      description:
        "Take the visitor to the Zenod sign-in page (Google by default, or GitHub). Only navigates; it does not sign in and does not pay. The visitor completes sign-in themselves.",
      inputSchema: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: Object.keys(SIGN_IN_PROVIDER_PATHS),
            description: "Sign-in provider. Defaults to google.",
          },
        },
      },
      annotations: { consequentialHint: true },
      execute: async (args) => {
        const provider = (args?.provider ?? "google") as SignInProvider
        const path = SIGN_IN_PROVIDER_PATHS[provider]
        if (path === undefined) {
          throw new Error(`Unknown provider. Use one of: ${Object.keys(SIGN_IN_PROVIDER_PATHS).join(", ")}`)
        }
        navigate(path)
        return text({ provider, url: path })
      },
    },
  ]
}

export function registerWebMcpTools(
  signal: AbortSignal,
  navigate: Navigate = (url) => window.location.assign(url),
  doc: Pick<Document, "modelContext"> | undefined = typeof document === "undefined" ? undefined : document,
  nav: Pick<Navigator, "modelContext"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
): void {
  const modelContext = doc?.modelContext ?? nav?.modelContext
  if (!modelContext || typeof modelContext.registerTool !== "function") return
  for (const tool of buildWebMcpTools(navigate)) {
    try {
      void Promise.resolve(modelContext.registerTool(tool, { signal })).catch(() => {})
    } catch {
      // A browser that rejects a tool must not break the page.
    }
  }
}
