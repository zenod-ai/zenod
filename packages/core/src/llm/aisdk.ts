import { generateObject, generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type {
  AnswerInput,
  AnswerResult,
  BrainLlm,
  Classification,
  ClassifyInput,
  ComposePageInput,
  VaultReadTools,
} from "./types.js";

export type Provider = "anthropic" | "openai";

export interface AiLlmOptions {
  provider: Provider;
  apiKey: string;
  /** Ask/chat loop model. */
  askModel?: string;
  /** Classification pass model. */
  classifyModel?: string;
}

/** Per-provider default models. Both are user-overridable in settings. */
export const PROVIDER_DEFAULTS: Record<Provider, { ask: string; classify: string }> = {
  anthropic: { ask: "claude-sonnet-4-6", classify: "claude-haiku-4-5" },
  openai: { ask: "gpt-4o", classify: "gpt-4o-mini" },
};

const MAX_STEPS = 15;

const classificationSchema = z.object({
  confidence: z.number().min(0).max(1).describe("how sure you are about where this memory belongs"),
  summary: z.string().describe("one line, imperative, for the commit message"),
  tags: z.array(z.string()).describe("tags from the vocabulary only"),
  pages: z
    .array(
      z.object({
        path: z.string().describe("vault-relative path like Areas/Insurance.md"),
        action: z.enum(["create", "update"]),
        title: z.string(),
      }),
    )
    .describe("meaning pages this memory touches (1-3)"),
  question: z
    .string()
    .optional()
    .describe("when confidence is low: one concrete question for the user about where this belongs"),
});

/**
 * The single LLM implementation, provider-agnostic via the Vercel AI SDK.
 * Switching provider is just a different model factory — the engine never
 * knows which one is running.
 */
export class AiSdkBrainLlm implements BrainLlm {
  private readonly askModelId: string;
  private readonly classifyModelId: string;
  private readonly model: (id: string) => Parameters<typeof generateText>[0]["model"];

  constructor(options: AiLlmOptions) {
    const defaults = PROVIDER_DEFAULTS[options.provider];
    this.askModelId = options.askModel || defaults.ask;
    this.classifyModelId = options.classifyModel || defaults.classify;
    this.model =
      options.provider === "openai"
        ? createOpenAI({ apiKey: options.apiKey })
        : createAnthropic({ apiKey: options.apiKey });
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const index = input.pageIndex
      .map((p) => `${p.path} | ${p.title} | tags: ${p.tags.join(",")} | ${p.summary}`)
      .join("\n");

    const { object } = await generateObject({
      model: this.model(this.classifyModelId),
      schema: classificationSchema,
      system: [
        "You are the librarian of a personal knowledge vault. Classify an incoming memory:",
        "decide which meaning page(s) it belongs to — update existing pages when one fits, create a new one only when nothing does.",
        "Folders: Areas/ (ongoing life domains), Projects/ (finite work), Notes/ (reusable knowledge).",
        `Tag vocabulary (use ONLY these): ${input.tagVocabulary.join(", ")}`,
        "Existing pages (path | title | tags | summary):",
        index || "(vault has no meaning pages yet)",
        "Prefer updating an existing page over creating a near-duplicate. Confidence below 0.7 means: ask the user instead of guessing — then include a concrete question.",
      ].join("\n"),
      prompt: [
        input.hints.length > 0 ? `Caller hints: ${input.hints.join("; ")}` : "",
        "Memory to classify:",
        input.content,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    return {
      confidence: typeof object.confidence === "number" ? object.confidence : 0,
      summary: object.summary || "stored a memory",
      tags: Array.isArray(object.tags) ? object.tags : [],
      pages: Array.isArray(object.pages) ? object.pages.slice(0, 3) : [],
      ...(object.question ? { question: object.question } : {}),
    };
  }

  async composePage(input: ComposePageInput): Promise<string> {
    const retryContext = input.previousErrors?.length
      ? `\n\nYour previous attempt failed validation with these errors — fix ALL of them:\n${input.previousErrors
          .map((e) => `- [${e.rule}] ${e.message}`)
          .join("\n")}`
      : "";

    const { text } = await generateText({
      model: this.model(this.askModelId),
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
      prompt: [
        `Page: ${input.path} (${input.classification.pages.find((p) => p.path === input.path)?.action ?? "update"})`,
        `Today: ${input.today}`,
        input.currentContent !== null
          ? `Current page content:\n${input.currentContent}`
          : `This page does not exist yet. Start from this template:\n${input.template}`,
        `New evidence entry (already recorded in the Log):\n${input.evidenceEntry}`,
        `Citation token for this evidence: ${input.citation}${retryContext}`,
      ].join("\n\n"),
    });

    return text.replace(/^```(?:markdown|md)?\n/, "").replace(/\n```\s*$/, "").trimEnd() + "\n";
  }

  async answer(input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult> {
    const readPaths = new Set<string>();
    const messages: ModelMessage[] = [
      ...input.conversation.map((m): ModelMessage => ({ role: m.role, content: m.text })),
      { role: "user", content: input.question },
    ];

    const { text } = await generateText({
      model: this.model(this.askModelId),
      system: input.vaultBriefing,
      messages,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: {
        search_vault: tool({
          description:
            "Search the vault. Call this first for any question about the user's knowledge — returns ranked paths with snippets.",
          inputSchema: z.object({ query: z.string() }),
          execute: ({ query }) => tools.searchVault(query),
        }),
        read_note: tool({
          description: "Read the full content of one note by its vault-relative path.",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            readPaths.add(path);
            return tools.readNote(path);
          },
        }),
        list_pages: tool({
          description: "List all meaning pages with their titles, tags, and summaries.",
          inputSchema: z.object({}),
          execute: () => tools.listPages(),
        }),
      },
    });

    return { text, readPaths: [...readPaths] };
  }
}

export function createBrainLlm(options: AiLlmOptions): BrainLlm {
  return new AiSdkBrainLlm(options);
}
