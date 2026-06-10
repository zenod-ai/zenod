import Anthropic from "@anthropic-ai/sdk";
import type {
  AnswerInput,
  AnswerResult,
  BrainLlm,
  Classification,
  ClassifyInput,
  ComposePageInput,
  VaultReadTools,
} from "./types.js";

export interface AnthropicLlmOptions {
  apiKey: string;
  /** Ask/chat loop model. */
  askModel?: string;
  /** Classification pass model. */
  classifyModel?: string;
}

const DEFAULT_ASK_MODEL = "claude-sonnet-4-6";
const DEFAULT_CLASSIFY_MODEL = "claude-haiku-4-5";
const MAX_TOOL_CALLS = 15;

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "number", description: "0-1: how sure you are about where this memory belongs" },
    summary: { type: "string", description: "one line, imperative, for the commit message" },
    tags: { type: "array", items: { type: "string" }, description: "tags from the vocabulary only" },
    pages: {
      type: "array",
      description: "meaning pages this memory touches (1-3)",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "vault-relative path like Areas/Insurance.md" },
          action: { type: "string", enum: ["create", "update"] },
          title: { type: "string" },
        },
        required: ["path", "action", "title"],
        additionalProperties: false,
      },
    },
    question: {
      type: "string",
      description: "when confidence is low: one concrete question for the user about where this belongs",
    },
  },
  required: ["confidence", "summary", "tags", "pages"],
  additionalProperties: false,
} as const;

export class AnthropicBrainLlm implements BrainLlm {
  private readonly client: Anthropic;
  private readonly askModel: string;
  private readonly classifyModel: string;

  constructor(options: AnthropicLlmOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.askModel = options.askModel ?? DEFAULT_ASK_MODEL;
    this.classifyModel = options.classifyModel ?? DEFAULT_CLASSIFY_MODEL;
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const index = input.pageIndex
      .map((p) => `${p.path} | ${p.title} | tags: ${p.tags.join(",")} | ${p.summary}`)
      .join("\n");

    const response = await this.client.messages.create({
      model: this.classifyModel,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA } },
      system: [
        "You are the librarian of a personal knowledge vault. Classify an incoming memory:",
        "decide which meaning page(s) it belongs to — update existing pages when one fits, create a new one only when nothing does.",
        "Folders: Areas/ (ongoing life domains), Projects/ (finite work), Notes/ (reusable knowledge).",
        `Tag vocabulary (use ONLY these): ${input.tagVocabulary.join(", ")}`,
        "Existing pages (path | title | tags | summary):",
        index || "(vault has no meaning pages yet)",
        "Prefer updating an existing page over creating a near-duplicate. Confidence below 0.7 means: ask the user instead of guessing — then include a concrete question.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            input.hints.length > 0 ? `Caller hints: ${input.hints.join("; ")}` : "",
            "Memory to classify:",
            input.content,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as Classification;
    return {
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      summary: parsed.summary || "stored a memory",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      pages: Array.isArray(parsed.pages) ? parsed.pages.slice(0, 3) : [],
      ...(parsed.question ? { question: parsed.question } : {}),
    };
  }

  async composePage(input: ComposePageInput): Promise<string> {
    const retryContext = input.previousErrors?.length
      ? `\n\nYour previous attempt failed validation with these errors — fix ALL of them:\n${input.previousErrors
          .map((e) => `- [${e.rule}] ${e.message}`)
          .join("\n")}`
      : "";

    const response = await this.client.messages.create({
      model: this.askModel,
      max_tokens: 4096,
      system: [
        "You are the librarian of a personal knowledge vault. Produce the COMPLETE new content of one meaning page, integrating a new piece of evidence.",
        "Hard rules (validated by code, not negotiable):",
        "- YAML frontmatter with exactly: title, type (project|area|note matching the folder), tags (from the vocabulary only), created, updated (YYYY-MM-DD), summary (one dense line written for a cold LLM reader).",
        `- Tag vocabulary: ${input.tagVocabulary.join(", ")}`,
        `- Every claim derived from the evidence must cite it inline: (${input.citation})`,
        "- The page must wikilink at least one other meaning page or index, e.g. [[Areas/Insurance|Insurance]].",
        "- Keep the page dense and self-contained; integrate, don't append a changelog.",
        "- Output ONLY the raw markdown file content. No code fences, no commentary.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Page: ${input.path} (${input.classification.pages.find((p) => p.path === input.path)?.action ?? "update"})`,
            `Today: ${input.today}`,
            input.currentContent !== null
              ? `Current page content:\n${input.currentContent}`
              : `This page does not exist yet. Start from this template:\n${input.template}`,
            `New evidence entry (already recorded in the Log):\n${input.evidenceEntry}`,
            `Citation token for this evidence: ${input.citation}${retryContext}`,
          ].join("\n\n"),
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    // strip accidental code fences
    return text.replace(/^```(?:markdown|md)?\n/, "").replace(/\n```\s*$/, "").trimEnd() + "\n";
  }

  async answer(input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult> {
    const readPaths = new Set<string>();
    const messages: Anthropic.MessageParam[] = [
      ...input.conversation.map(
        (m): Anthropic.MessageParam => ({ role: m.role, content: m.text }),
      ),
      { role: "user", content: input.question },
    ];

    const toolDefs: Anthropic.Tool[] = [
      {
        name: "search_vault",
        description:
          "Search the vault. Call this first for any question about the user's knowledge — returns ranked paths with snippets.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "read_note",
        description: "Read the full content of one note by its vault-relative path.",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "list_pages",
        description: "List all meaning pages with their titles, tags, and summaries.",
        input_schema: { type: "object", properties: {} },
      },
    ];

    let toolCalls = 0;
    while (true) {
      const response = await this.client.messages.create({
        model: this.askModel,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: input.vaultBriefing,
        tools: toolDefs,
        messages,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0 || toolCalls >= MAX_TOOL_CALLS) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return { text, readPaths: [...readPaths] };
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolCalls++;
        const inputArgs = use.input as Record<string, string>;
        let result: string;
        try {
          if (use.name === "search_vault") result = await tools.searchVault(inputArgs.query ?? "");
          else if (use.name === "read_note") {
            result = await tools.readNote(inputArgs.path ?? "");
            if (inputArgs.path) readPaths.add(inputArgs.path);
          } else if (use.name === "list_pages") result = await tools.listPages();
          else result = `unknown tool: ${use.name}`;
        } catch (err) {
          result = `error: ${(err as Error).message}`;
        }
        results.push({ type: "tool_result", tool_use_id: use.id, content: result });
      }
      messages.push({ role: "user", content: results });
    }
  }
}
