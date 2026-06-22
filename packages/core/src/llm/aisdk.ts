import { generateObject, generateText, stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { peerMutationGuardFailure } from "../taskingPolicy.js";
import type {
  AnswerInput,
  AnswerResult,
  BacklogExtractInput,
  BacklogExtractResult,
  BrainLlm,
  Classification,
  ClassifyInput,
  ComposePageInput,
  DriveSourceTools,
  PeerTools,
  VaultReadTools,
  VaultTaskTools,
  VaultWriteTools,
  WorkLoopInput,
  WorkLoopResult,
} from "./types.js";

export type Provider = "anthropic" | "openai" | "openrouter" | "groq";

/**
 * OpenAI-compatible third-party gateways. They speak the Chat Completions API,
 * so we reach them through `@ai-sdk/openai` with a custom baseURL and the
 * `.chat()` model (the default model uses the Responses API, which these
 * providers do not implement).
 */
const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<Provider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
};

/** The six LLM operations, tagged on every usage report for cost analytics. */
export type LlmOperation = "classify" | "compose" | "answer" | "work" | "extractBacklog" | "describeImage";

/**
 * Real, provider-billed token usage for one LLM call — read from the AI SDK
 * result, not estimated. The cache split matters for cost: reads bill at
 * ~0.1x the input rate, writes at ~1.25x, so they're tracked separately.
 */
export interface LlmUsageReport {
  operation: LlmOperation;
  provider: Provider;
  model: string;
  /** Uncached input tokens, billed at the standard input rate. */
  inputTokens: number;
  outputTokens: number;
  /** Cache-read input tokens (billed ~0.1x input). */
  cachedInputTokens: number;
  /** Cache-write input tokens (billed ~1.25x input). */
  cacheCreationInputTokens: number;
}

export interface AiLlmOptions {
  provider: Provider;
  apiKey: string;
  /** Ask/chat loop model. */
  askModel?: string;
  /** Classification pass model. */
  classifyModel?: string;
  /**
   * Vision model for image description. Must support image content blocks.
   * Defaults to a provider-specific model known to support vision — separate
   * from askModel because users often configure a text-only ask model.
   */
  visionModel?: string;
  /**
   * Tool-step budget for an answer turn. The model is told this limit and the
   * final step forces a text answer. Clamped to [MIN_MAX_STEPS, MAX_MAX_STEPS];
   * undefined uses DEFAULT_MAX_STEPS.
   */
  maxSteps?: number;
  /**
   * Optional sink for real, provider-billed token usage per call. The server
   * wires this to a durable usage store for cost analytics. It must never
   * throw into the call path — a metering failure must not break a chat turn.
   */
  onUsage?: (report: LlmUsageReport) => void;
}

/** Per-provider default models. All are user-overridable in settings. */
export const PROVIDER_DEFAULTS: Record<Provider, { ask: string; classify: string; vision: string }> = {
  anthropic: { ask: "claude-sonnet-4-6", classify: "claude-haiku-4-5", vision: "claude-sonnet-4-6" },
  openai: { ask: "gpt-4o-mini", classify: "gpt-4o-mini", vision: "gpt-4o-mini" },
  openrouter: { ask: "deepseek/deepseek-chat", classify: "deepseek/deepseek-chat", vision: "google/gemini-3.1-flash-lite" },
  groq: { ask: "llama-3.3-70b-versatile", classify: "llama-3.1-8b-instant", vision: "meta-llama/llama-4-scout-17b-16e-instruct" },
};

/**
 * Default tool-step budget for an answer turn when none is configured. The
 * model is *told* this budget and the last step forces a text answer, so it
 * plans its tool calls and can never run out mid-loop and reply with nothing.
 * Configurable per server via the "Max tool steps per reply" setting.
 */
export const DEFAULT_MAX_STEPS = 8;
export const MIN_MAX_STEPS = 2;
export const MAX_MAX_STEPS = 20;
export const MAX_WORK_STEPS = 12;

/** Clamp a configured step budget to a sane range; falls back to the default. */
export function clampMaxSteps(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_STEPS;
  return Math.max(MIN_MAX_STEPS, Math.min(MAX_MAX_STEPS, Math.round(value)));
}

type ModelFactory = (id: string) => Parameters<typeof generateText>[0]["model"];

/**
 * Build the per-provider model factory. Anthropic and OpenAI use their native
 * providers; OpenRouter and Groq are OpenAI-compatible gateways reached via the
 * OpenAI provider with a custom baseURL and the Chat Completions model.
 */
function createModelFactory(provider: Provider, apiKey: string): ModelFactory {
  if (provider === "anthropic") return createAnthropic({ apiKey });
  if (provider === "openai") return createOpenAI({ apiKey });
  const baseURL = OPENAI_COMPATIBLE_BASE_URLS[provider];
  const compatible = createOpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  return (id: string) => compatible.chat(id);
}

/** Tool callbacks may fail (bad path, immutable tier); surface the error to the model instead of aborting the loop. */
function caught(run: () => Promise<string>): Promise<string> {
  return run().catch((err: unknown) => `ERROR: ${(err as Error).message}`);
}

/** Pull a readable message out of a provider error part (shapes vary by SDK/provider). */
function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  const e = err as { error?: { message?: string; code?: string }; message?: string } | null;
  return e?.error?.message ?? e?.message ?? "the model provider returned an error";
}

/** Human-facing label for the "calling a tool…" indicator in the chat UI. */
function toolLabel(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "search_vault":
      return typeof args.query === "string" ? `Searching the vault for “${args.query}”` : "Searching the vault";
    case "read_note":
      return typeof args.path === "string" ? `Reading ${args.path}` : "Reading a note";
    case "list_pages":
      return "Listing vault pages";
    case "search_chats":
      return typeof args.query === "string" ? `Searching past chats for “${args.query}”` : "Searching past chats";
    case "list_drive_files":
      return "Listing your Google Drive";
    case "ingest_drive_file":
      return "Queuing a Google Drive file for transcription";
    case "propose_vault_task":
      return "Planning vault changes";
    case "execute_vault_task":
      return "Reorganizing the vault";
    case "digest_backlog":
      return "Mining backlog candidates";
    case "capture_note":
      return "Filing a note";
    case "create_issue":
      return "Creating a GitHub issue";
    case "label_issue":
      return "Labeling a GitHub issue";
    case "query_backlog":
      return "Checking backlog status";
    case "service_backlog":
      return "Selecting backlog work";
    // Mesh / peer-agent tools (routed to another agent over MCP). These give the
    // chat activity line a readable trail of what a delegated agent is doing.
    case "ask_zenod":
      return "Asking Zenod";
    case "search_memory":
      return "Searching Zenod’s memory";
    case "get_memory":
      return "Reading a memory";
    case "add_memory":
      return "Saving to Zenod’s memory";
    case "store_memory":
      return "Filing a memory";
    case "get_task_result":
      return "Checking filing status";
    case "ask_archus":
      return "Asking Archus about the backlog";
    case "open_issue":
      return "Opening a GitHub issue";
    case "edit_issue":
      return "Editing a GitHub issue";
    case "close_issue":
      return "Closing a GitHub issue";
    case "queue_execution":
      return "Queuing for execution";
    case "approve_execution":
      return "Approving execution to ship";
    // Epaminon (executor) — running queued tickets and reporting outcomes.
    case "run_ticket":
      return "Running a ticket";
    case "report_outcome":
      return "Reporting an execution outcome";
    case "execution_status":
      return "Checking execution status";
    case "ask_epaminon":
      return "Asking Epaminon about execution";
    // Callistheness (marketing/comms guardian) — drafting and, after confirmation, publishing.
    case "ask_outbound":
      return "Asking Callistheness";
    case "post_tweet":
      return "Posting to X";
    case "post_reddit":
      return "Posting to Reddit";
    case "send_email":
      return "Sending an email";
    // Phylax (attention gatekeeper) — inbound events and principal notifications.
    case "raise_event":
      return "Raising an event to Phylax";
    case "ask_phylax":
      return "Asking Phylax";
    case "deliver_to_principal":
      return "Notifying Jordi";
    default:
      return `Running ${toolName}`;
  }
}

/**
 * Classification schema. Every field is REQUIRED — optional fields are
 * expressed as `.nullable()`, never `.optional()`. OpenAI's strict structured
 * outputs reject a `required` array that omits any property key, so an
 * `.optional()` field there is a 400. nullable-but-required works on both
 * OpenAI and Anthropic. (Regression-tested in test/schema-llm.test.ts.)
 */
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
    .nullable()
    .describe("when confidence is low: one concrete question for the user about where this belongs; null otherwise"),
});

/** Exposed for regression testing the OpenAI-strict constraint. */
export { classificationSchema };

const backlogCandidateSchema = z.object({
  title: z.string().describe("short issue/backlog title"),
  type: z.enum(["action", "question-action", "blocker", "roadmap", "follow-up"]),
  owner: z.enum(["agent", "human", "unknown"]),
  priority: z.enum(["P0", "P1", "P2", "unknown"]),
  status: z.enum(["proposed", "ready", "blocked", "needs-clarification"]),
  source_refs: z.array(
    z.object({
      path: z.string().describe("vault-relative path, optionally with a block anchor"),
      githubUrl: z.string().describe("GitHub URL for the source, or empty string when unavailable"),
    }),
  ),
  summary: z.string(),
  context: z.string(),
  acceptance_criteria: z.array(z.string()),
  dependencies: z.array(z.string()),
  open_questions: z.array(z.string()),
  difficulty: z.enum(["low", "medium", "high", "unknown"]),
  suggested_labels: z.array(z.string()),
  target_repo: z.string().nullable().describe("repo slug when relevant, otherwise null"),
});

const backlogExtractSchema = z.object({
  candidates: z.array(backlogCandidateSchema),
});

export { backlogCandidateSchema, backlogExtractSchema };

/**
 * The single LLM implementation, provider-agnostic via the Vercel AI SDK.
 * Switching provider is just a different model factory — the engine never
 * knows which one is running.
 */
export class AiSdkBrainLlm implements BrainLlm {
  private readonly askModelId: string;
  private readonly classifyModelId: string;
  private readonly visionModelId: string;
  private readonly maxSteps: number;
  private readonly provider: Provider;
  private readonly onUsage: ((report: LlmUsageReport) => void) | undefined;
  private readonly model: (id: string) => Parameters<typeof generateText>[0]["model"];

  /**
   * Anthropic prompt-cache breakpoint for the big, stable system prefix (the
   * vault briefing). Repeated turns within the 5-minute window read it at
   * ~0.1x instead of re-billing the full prefix every message. Non-Anthropic
   * providers ignore the `anthropic` namespace, so attaching it is always safe.
   */
  private readonly cacheBreakpoint = { anthropic: { cacheControl: { type: "ephemeral" } } };

  constructor(options: AiLlmOptions) {
    const defaults = PROVIDER_DEFAULTS[options.provider];
    this.askModelId = options.askModel || defaults.ask;
    this.classifyModelId = options.classifyModel || defaults.classify;
    this.visionModelId = options.visionModel || defaults.vision;
    this.maxSteps = clampMaxSteps(options.maxSteps);
    this.provider = options.provider;
    this.onUsage = options.onUsage;
    this.model = createModelFactory(options.provider, options.apiKey);
  }

  /**
   * Forward real token usage from an AI SDK result to the usage sink. Reads
   * the standardized `usage` fields plus Anthropic's cache split from
   * `providerMetadata`. Swallows its own errors — metering never breaks a turn.
   */
  private reportUsage(
    operation: LlmOperation,
    modelId: string,
    usage:
      | { inputTokens?: number | undefined; outputTokens?: number | undefined; cachedInputTokens?: number | undefined }
      | undefined,
    providerMetadata: Record<string, unknown> | undefined,
  ): void {
    if (!this.onUsage) return;
    const anthropic = (providerMetadata?.anthropic ?? {}) as {
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    };
    try {
      this.onUsage({
        operation,
        provider: this.provider,
        model: modelId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? anthropic.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: anthropic.cacheCreationInputTokens ?? 0,
      });
    } catch {
      // Metering must never break the call path.
    }
  }

  /**
   * Recover a turn that ran its tools but produced no final text. Reasoning
   * models (e.g. grok) sometimes spend their whole output budget on reasoning
   * + tool calls and end the turn without writing an answer block, so
   * `result.text` is empty even though the work is done and the tool results
   * are sitting in context. The `prepareStep` force-text guard only covers
   * running OUT of steps — it never fires when the model stops voluntarily.
   * Re-prompt once with tools disabled to make the model write the answer it
   * already gathered. Returns "" if it still yields nothing, so the engine's
   * finalizeReply shows a graceful fallback rather than a silent empty bubble.
   */
  private async recoverEmptyAnswer(
    model: Parameters<typeof generateText>[0]["model"],
    priorMessages: ModelMessage[],
    responseMessages: ModelMessage[],
    reasoning: string,
    onTextDelta?: (delta: string) => void,
  ): Promise<string> {
    console.warn(
      `[answer] empty final text after ${responseMessages.length} response message(s)` +
        (reasoning ? ` (${reasoning.length} chars of reasoning dropped)` : "") +
        "; forcing a closing text step",
    );
    try {
      const retry = await generateText({
        model,
        messages: [
          ...priorMessages,
          ...responseMessages,
          {
            role: "user",
            content:
              "Write your final answer now as plain text, based on what you found above. Do not call any tools.",
          },
        ],
        toolChoice: "none",
      });
      this.reportUsage("answer", this.askModelId, retry.totalUsage, retry.providerMetadata);
      if (retry.text.trim()) {
        onTextDelta?.(retry.text);
        return retry.text;
      }
      console.warn("[answer] forced closing step still produced empty text");
    } catch (err) {
      console.warn(`[answer] forced closing step failed: ${(err as Error).message}`);
    }
    return "";
  }

  async describeImage(imageData: Uint8Array, mimeType: string, prompt?: string): Promise<string> {
    const description =
      prompt ??
      "Describe this image in detail. Extract any visible text, context, diagrams, notes, or action items. Be thorough — this description will be stored as a memory.";
    const { text, usage, providerMetadata } = await generateText({
      model: this.model(this.visionModelId),
      messages: [
        {
          role: "user",
          content: [
            { type: "image" as const, image: imageData, mediaType: mimeType },
            { type: "text" as const, text: description },
          ],
        },
      ] as ModelMessage[],
    });
    this.reportUsage("describeImage", this.visionModelId, usage, providerMetadata);
    return text;
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const index = input.pageIndex
      .map((p) => `${p.path} | ${p.title} | tags: ${p.tags.join(",")} | ${p.summary}`)
      .join("\n");

    const { object, usage, providerMetadata } = await generateObject({
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
    this.reportUsage("classify", this.classifyModelId, usage, providerMetadata);

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

    const { text, usage, providerMetadata } = await generateText({
      model: this.model(this.askModelId),
      system: [
        "You are the librarian of a personal knowledge vault. Produce the COMPLETE new content of one meaning page, integrating a new piece of evidence.",
        "Hard rules (validated by code, not negotiable):",
        "- YAML frontmatter with exactly these keys: title, type, tags, created, updated (YYYY-MM-DD), summary (one dense line written for a cold LLM reader), description (same value as summary, for OKF consumers), timestamp (ISO 8601 datetime for updated at 00:00:00Z unless a better source time is known).",
        `- The 'type' field MUST be exactly: ${input.requiredType}`,
        `- 'tags' may only use this vocabulary: ${input.tagVocabulary.join(", ")}`,
        `- Every claim derived from the evidence must cite it inline: (${input.citation})`,
        "- The page MUST wikilink at least one existing page (no orphans). Include at least one of these exact links, e.g. on a final 'Related:' line:",
        input.linkHints.length > 0 ? `  ${input.linkHints.join("  ")}` : "  (link to the most relevant folder index)",
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
    this.reportUsage("compose", this.askModelId, usage, providerMetadata);

    return text.replace(/^```(?:markdown|md)?\n/, "").replace(/\n```\s*$/, "").trimEnd() + "\n";
  }

  async extractBacklog(input: BacklogExtractInput): Promise<BacklogExtractResult> {
    const { object, usage, providerMetadata } = await generateObject({
      model: this.model(this.classifyModelId),
      schema: backlogExtractSchema,
      system: [
        "You are Zenod's backlog/action digester. Mine memory evidence into structured backlog candidates.",
        "Extract concrete actions, question-actions, launch blockers, roadmap/phaseable items, dependencies, priority, difficulty, acceptance criteria, and open clarifying questions.",
        "Use only what the source supports. If an item is not executable, set status to needs-clarification and include open_questions.",
        "Distinguish launch blockers from roadmap items when the source context says so.",
        "Every candidate must keep source_refs from the provided source references. Do not emit candidates that have no source evidence.",
        "Owner, priority, difficulty, target_repo, and labels are hints; use unknown or null instead of inventing precision.",
      ].join("\n"),
      prompt: [
        "Source refs:",
        JSON.stringify(input.sourceRefs),
        "Memory/transcript content:",
        input.content,
      ].join("\n\n"),
    });
    this.reportUsage("extractBacklog", this.classifyModelId, usage, providerMetadata);

    return {
      candidates: object.candidates.map((candidate) => {
        const { target_repo, ...rest } = candidate;
        return target_repo ? { ...rest, target_repo } : rest;
      }),
    };
  }

  async answer(
    input: AnswerInput,
    tools: VaultReadTools,
    taskTools?: VaultTaskTools,
    driveTools?: DriveSourceTools,
    peerTools?: PeerTools,
  ): Promise<AnswerResult> {
    const readPaths = new Set<string>();
    const messages: ModelMessage[] = [
      ...input.conversation.map((m): ModelMessage => ({ role: m.role, content: m.text })),
      { role: "user", content: input.question },
    ];

    const taskToolSet = taskTools
      ? {
          capture_note: tool({
            description:
              "Capture/file an inbound note through the librarian store pipeline. Use when the user asks to file, capture, save, remember, or log a note/message. Returns evidence, touched pages, commit, and URLs.",
            inputSchema: z.object({
              content: z.string().describe("the note text to file"),
              hints: z.array(z.string()).nullable().describe("optional filing hints; null for none"),
            }),
            execute: async ({ content, hints }) => {
              const result = await taskTools.captureNote(content, hints ?? undefined);
              if (result.queued) {
                // Filing runs in the background and is NOT committed yet. Capturing
                // is a side-effect — the model must still reply to the user's actual
                // message, never answer with only a capture/queue acknowledgment
                // (that produced the "Queued for filing." non-replies on voice notes).
                return "Captured in the background (filing to the vault, not yet committed — do not claim it is already filed). This is a side-effect: now reply to the user's actual message. Do NOT reply with only a capture/queue acknowledgment.";
              }
              return [
                `Filed: ${result.evidenceRef}`,
                ...(result.pagesTouched.length > 0 ? [`Pages: ${result.pagesTouched.join(", ")}`] : []),
                `Commit: ${result.commitSha}`,
                ...(result.githubUrls.length > 0 ? ["URLs:", ...result.githubUrls.map((url) => `- ${url}`)] : []),
                ...(result.question ? [`Question: ${result.question}`] : []),
              ].join("\n");
            },
          }),
          propose_vault_task: tool({
            description:
              "Plan vault maintenance/reorganization (sweep the Inbox, merge or refile pages, restructure folders). The librarian surveys the vault read-only and returns a concrete operation-by-operation plan. NOTHING is changed. Relay the returned plan to the user verbatim and ask for approval. Use whenever the user asks to clean up, move, reorganize, or restructure.",
            inputSchema: z.object({
              objective: z.string().describe("what to accomplish, in the user's terms"),
            }),
            execute: ({ objective }) => caught(() => taskTools.proposeTask(objective)),
          }),
          execute_vault_task: tool({
            description:
              "Execute a previously proposed vault plan. ONLY call this after the user has explicitly approved that plan in this conversation ('yes', 'go ahead', 'do it'). Pass the approved plan exactly as it was shown (minus any parts the user rejected). Changes are validated and land as one git commit; evidence (Log/, _attachments/) can never be touched.",
            inputSchema: z.object({
              objective: z.string().describe("the original objective"),
              plan: z.string().describe("the user-approved plan, verbatim"),
            }),
            execute: ({ objective, plan }) => caught(() => taskTools.executeTask(objective, plan)),
          }),
          digest_backlog: tool({
            description:
              "Mine a transcript, memory note, or scoped vault query for structured backlog/action candidates with citations. Returns proposed candidates by default. Only set write=true after the user explicitly asks to materialize proposed backlog records; this writes Backlog/ records, not GitHub issues and not task execution.",
            inputSchema: z.object({
              rawText: z.string().nullable().describe("raw transcript or note text to mine directly; null when using memoryPath or query"),
              memoryPath: z.string().nullable().describe("vault-relative note/log path to mine; null when using rawText or query"),
              query: z.string().nullable().describe("vault search scope, e.g. 'recent Zenod voice notes launch backlog'; null when using rawText or memoryPath"),
              sourceRefs: z
                .array(z.object({ path: z.string(), githubUrl: z.string() }))
                .nullable()
                .describe("source refs to attach to rawText candidates; null for none"),
              write: z
                .boolean()
                .nullable()
                .describe("true only when the user explicitly asked to write proposed Backlog/ records; null/false returns proposals only"),
            }),
            execute: async ({ rawText, memoryPath, query, sourceRefs, write }) => {
              const result = await taskTools.digestBacklog({
                ...(rawText ? { rawText } : {}),
                ...(memoryPath ? { memoryPath } : {}),
                ...(query ? { query } : {}),
                ...(sourceRefs ? { sourceRefs } : {}),
                ...(write !== null ? { write: Boolean(write) } : {}),
              });
              return [
                `Backlog candidates: ${result.candidates.length}`,
                ...result.candidates.map((candidate, index) => {
                  const sources = candidate.source_refs.map((ref) => ref.path).join(", ");
                  return `${index + 1}. [${candidate.priority}/${candidate.type}/${candidate.status}] ${candidate.title}${sources ? ` — ${sources}` : ""}`;
                }),
                ...(result.written.length > 0
                  ? ["Written:", ...result.written.map((item) => `- ${item.path}${item.githubUrl ? ` (${item.githubUrl})` : ""}`)]
                  : []),
                ...(result.skipped.length > 0
                  ? ["Skipped:", ...result.skipped.map((item) => `- ${item.title ? `${item.title}: ` : ""}${item.reason}`)]
                  : []),
              ].join("\n");
            },
          }),
          create_issue: tool({
            description:
              "Create a GitHub issue when the user asks to create/open/file one. The issue MUST be runnable by an autonomous agent: a clear objective, explicit scope (in/out of scope), and a done-condition / acceptance criteria. For code work, name the relevant files/surfaces; for actions (post a tweet, send a message, etc.) state the exact action and whether to execute it directly or draft for approval. If the user's request is missing any of this, ASK one short clarifying question and DO NOT create the issue yet — never file a ticket that can't be run. Agent-created issues are proposals only: use status:proposed, never status:queued. Use the configured repository unless the user specifies another owner/repo. Return the issue URL to the user and render the issue as a clickable markdown link in the final reply, e.g. [#123 Title](https://github.com/owner/repo/issues/123). If the SAME request also asks to queue/run/execute the ticket (e.g. 'create a ticket for X and queue it'), creating it is NOT enough — it stays status:proposed and the runner will never touch it. You MUST then call queue_execution with the qualified issue id this call returns, in this same turn.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured vault/project repo"),
              title: z.string().describe("issue title"),
              body: z
                .string()
                .describe(
                  "Runnable issue body. Must contain: ## Objective, ## Scope (in scope / out of scope), ## Acceptance criteria (done when …), and source context (vault paths or links the worker should read). Keep it tight.",
                ),
              labels: z.array(z.string()).nullable().describe("labels to apply at creation time; null for none"),
            }),
            execute: ({ repo, title, body, labels }) =>
              caught(() =>
                taskTools.createIssue({
                  repo: repo ?? "",
                  title,
                  body,
                  ...(labels ? { labels } : {}),
                }),
              ),
          }),
          label_issue: tool({
            description:
              "Apply labels to an existing GitHub issue after creating or locating it. This agent tool may propose work with status:proposed, but must never apply status:queued; only a human can approve proposed work into queued.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured vault/project repo"),
              issueNumber: z.number().int().positive().describe("GitHub issue number"),
              labels: z.array(z.string()).min(1).describe("labels to add"),
            }),
            execute: ({ repo, issueNumber, labels }) =>
              caught(() => taskTools.labelIssue({ repo: repo ?? "", issueNumber, labels })),
          }),
          edit_issue: tool({
            description:
              "Edit an EXISTING GitHub issue in place when the user asks to change/update/revise/broaden a ticket — its body, title, labels, or status — or to post a comment on it. Use this instead of closing-and-recreating a ticket: pass the issue number and only the fields to change. `body` REPLACES the whole body, so include the full revised text (read the current issue first via query_backlog or the GitHub URL if you need its existing content). For status, pass a label like 'needs-update', 'blocked', or 'proposed'. To CLOSE an issue set state='closed' (optionally stateReason 'completed' or 'not_planned'); set state='open' to reopen — this changes GitHub's actual issue state, not a label. IMPORTANT: this tool can NEVER set status:queued or status:approved-merge — execution starts through queue_execution and merge approval stays with approve_merge. Returns the operations performed and the issue URL; render referenced issues as clickable markdown links in the final reply.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured vault/project repo"),
              issueNumber: z.number().int().positive().describe("GitHub issue number to edit"),
              title: z.string().nullable().describe("new title; null to leave unchanged"),
              body: z.string().nullable().describe("new full body (replaces existing); null to leave unchanged"),
              labelsAdd: z.array(z.string()).nullable().describe("labels to add; null for none"),
              labelsRemove: z.array(z.string()).nullable().describe("labels to remove; null for none"),
              labelsSet: z.array(z.string()).nullable().describe("replace ALL labels with this exact set; null to leave unchanged"),
              comment: z.string().nullable().describe("a comment to post on the issue; null for none"),
              status: z
                .string()
                .nullable()
                .describe("non-gated status label to set, e.g. 'needs-update' or 'blocked'; null to leave unchanged. Cannot set queued/approved-merge."),
              state: z
                .enum(["open", "closed"])
                .nullable()
                .describe("set 'closed' to close the issue or 'open' to reopen it (GitHub state, not a label); null to leave unchanged"),
              stateReason: z
                .enum(["completed", "not_planned", "reopened"])
                .nullable()
                .describe("why it closed; null defaults to 'completed' when closing"),
            }),
            execute: ({ repo, issueNumber, title, body, labelsAdd, labelsRemove, labelsSet, comment, status, state, stateReason }) =>
              caught(() =>
                taskTools.editIssue({
                  ...(repo ? { repo } : {}),
                  issueNumber,
                  ...(title !== null ? { title } : {}),
                  ...(body !== null ? { body } : {}),
                  ...(labelsAdd ? { labelsAdd } : {}),
                  ...(labelsRemove ? { labelsRemove } : {}),
                  ...(labelsSet ? { labelsSet } : {}),
                  ...(comment ? { comment } : {}),
                  ...(status !== null ? { status } : {}),
                  ...(state !== null ? { state } : {}),
                  ...(stateReason !== null ? { stateReason } : {}),
                }),
              ),
          }),
          close_issue: tool({
            description:
              "CLOSE a GitHub issue — the dedicated way to close. Pass the issue number and this sets GitHub's actual issue state to closed (it does NOT just add a label or comment). Use this whenever the user asks to close/resolve/done a ticket; do not use edit_issue for closing. Optionally include a closing comment and set notPlanned for a won't-do close. Returns the closed issue URL.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured backlog/vault repo"),
              issueNumber: z.number().int().positive().describe("GitHub issue number to close"),
              comment: z.string().nullable().describe("optional closing comment to post; null for none"),
              notPlanned: z.boolean().nullable().describe("true to close as not_planned (won't-do); null/false closes as completed"),
            }),
            execute: ({ repo, issueNumber, comment, notPlanned }) =>
              caught(() =>
                taskTools.closeIssue({
                  ...(repo ? { repo } : {}),
                  issueNumber,
                  ...(comment ? { comment } : {}),
                  ...(notPlanned ? { notPlanned: true } : {}),
                }),
              ),
          }),
          queue_execution: tool({
            description:
              "QUEUE a work ticket for execution — call ONLY when the human has EXPLICITLY approved running a specific ticket (e.g. 'run owner/repo#5', 'queue #12 for execution'). It mints a central type:execution ticket (exec:queued) that links the target work ticket and carries the run context, then dispatches it to Epaminon (the executor). Minting IS queuing — do not also set status:queued. Never queue from a vague request, never bulk-queue. Returns the new execution ticket id + URL. In the final reply, include clickable markdown links for both the target ticket and the execution ticket whenever URLs are available.",
            inputSchema: z.object({
              target: z.string().min(1).describe("The work ticket to run, qualified owner/repo#N (the real home of the work)"),
              title: z.string().min(1).describe("Short title for the execution ticket, e.g. 'Run obsidian-brain#5'"),
              context: z.string().min(1).describe("The run context: objective, scope, done-condition + the goal — what the executor needs to do the work"),
              repo: z.string().nullable().describe("Central backlog repo for the execution ticket; null uses the configured backlog repo"),
            }),
            execute: ({ target, title, context, repo }) =>
              caught(() => taskTools.queueExecution({ target, title, context, ...(repo ? { repo } : {}) })),
          }),
          approve_execution: tool({
            description:
              "APPROVE a needs-review execution ticket to ship — call ONLY when the human has explicitly approved the actual content/outcome of an execution at exec:needs-review (e.g. they OK'd a drafted tweet, or approved merging a PR). It flips the execution ticket to exec:approved and tells Epaminon to ship (send/merge). Pass the execution ticket number. If the human edited the content, pass it as finalContent. Do NOT approve from a vague request.",
            inputSchema: z.object({
              executionId: z.number().int().positive().describe("The execution ticket number (central backlog) to approve"),
              finalContent: z.string().nullable().describe("The human's final/edited content to ship, if it changed; null to ship as-is"),
              repo: z.string().nullable().describe("Central backlog repo of the execution ticket; null uses the configured backlog repo"),
            }),
            execute: ({ executionId, finalContent, repo }) =>
              caught(() =>
                taskTools.approveExecution({ executionId, ...(finalContent ? { finalContent } : {}), ...(repo ? { repo } : {}) }),
              ),
          }),
          approve_queue: tool({
            description:
              "DEPRECATED — do NOT use this to run a ticket. To queue work for execution use `queue_execution`, which mints the execution ticket Epaminon runs (the two-tier model). This legacy tool only sets the old status:queued label for the migration-era runner that scans labels directly; it is kept for compatibility, not as the way to run work. If you ever do use it, never claim a ticket is 'queued'/'running'/'poked' unless THIS tool returned success for that number.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured vault/project repo"),
              issueNumbers: z
                .array(z.number().int().positive())
                .min(1)
                .describe("the issue numbers the human explicitly approved to run now"),
            }),
            execute: ({ repo, issueNumbers }) => caught(() => taskTools.approveQueue({ repo: repo ?? "", issueNumbers })),
          }),
          approve_merge: tool({
            description:
              "Approve merging the pull request(s) produced for backlog tickets currently at status:needs-review. Flips them to status:approved-merge so the controller merges the PR on green CI. THIS IS THE ONLY TOOL THAT CAN APPROVE A MERGE. Call it ONLY when the human has EXPLICITLY approved specific tickets to merge by number in this conversation (e.g. 'merge #44', 'yes, ship 51 and 53'). Never infer approval; never merge on a vague request. You do not merge directly — the controller merges on green and reports back. After approving, tell the user exactly which tickets were approved to merge.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo of the backlog ticket; null uses the configured vault/project repo"),
              issueNumbers: z
                .array(z.number().int().positive())
                .min(1)
                .describe("the backlog ticket numbers the human explicitly approved to merge now"),
            }),
            execute: ({ repo, issueNumbers }) => caught(() => taskTools.approveMerge({ repo: repo ?? "", issueNumbers })),
          }),
          query_backlog: tool({
            description:
              "Return real status for backlog/issues. Use when the user asks where things stand, issue/PR status, backlog status, blockers, artifacts, PR links, or what is ready next. Explicit IDs like owner/repo#108, '#108 in owner/repo', or 'PR #110' are direct lookups across open/closed issues and pull requests, with recent comments included; a fuzzy open-issue search miss is NOT proof that a ticket never existed. ALSO call this BEFORE you confirm, restate, or 'confirm' a specific ticket's status (e.g. the user asks 'is #76 approved?', 'confirm what's queued', 'what's in the merge') — ground the answer in this turn's live backlog rather than restating status from memory or earlier conversation. Asserting a ticket is approved/queued/merged/blocked without a tool result behind it gets flagged to the user as unconfirmed. Each result line includes the issue's GitHub URL — whenever you list or reference issues (a table, a summary, a single mention), render each as a clickable markdown link to that URL by default (e.g. [#76](https://github.com/owner/repo/issues/76)); do not make the user ask for links.",
            inputSchema: z.object({
              query: z.string().nullable().describe("optional status scope; null for general open backlog/issues"),
            }),
            execute: ({ query }) => caught(() => taskTools.queryBacklog(query ?? undefined)),
          }),
          service_backlog: tool({
            description:
              "Select eligible backlog work for servicing. This is a stub for the runner: it returns the eligible set/status and does not launch agents or execute work.",
            inputSchema: z.object({
              query: z.string().nullable().describe("optional selection scope; null for general eligible backlog"),
            }),
            execute: ({ query }) => caught(() => taskTools.serviceBacklog(query ?? undefined)),
          }),
        }
      : {};

    const driveToolSet = driveTools
      ? {
          list_drive_files: tool({
            description:
              "List files waiting in the user's Google Drive inbox folder, newest first (already-ingested files live in its Archive/ subfolder and are not shown). Optional query filters by file name. Returns one file per line: name, file ID, type, size, modified date. Use when the user mentions files, recordings, or voice notes they dropped in Drive.",
            inputSchema: z.object({
              query: z.string().nullable().describe("filter by file name (substring); null lists everything"),
            }),
            execute: ({ query }) => caught(() => driveTools.listDriveFiles(query ?? undefined)),
          }),
          ingest_drive_file: tool({
            description:
              "Queue one Google Drive file (by file ID from list_drive_files) for background transcription: it downloads, transcribes audio voice notes with the configured transcription provider (Groq when set, otherwise local whisper.cpp), files the transcript into the vault as evidence + meaning, commits, and archives the original — all in a background worker that survives the user navigating away. Returns immediately with the job id and status; it does NOT wait for completion. Call once per file. Tell the user the files are queued/processing and that live progress is in the Transcription panel.",
            inputSchema: z.object({
              fileId: z.string().describe("the Drive file ID"),
              hints: z
                .array(z.string())
                .nullable()
                .describe("optional filing hints, e.g. 'belongs to the housing project'; null for none"),
            }),
            execute: ({ fileId, hints }) => caught(() => driveTools.ingestDriveFile(fileId, hints ?? undefined)),
          }),
        }
      : {};

    // Peer-agent delegation tools (the mesh). Each configured peer becomes one
    // tool (e.g. `ask_zenod`) that forwards a free-form request to that peer and
    // returns its answer. The model sees them as ordinary tools.
    const peerEntries = Object.entries(peerTools ?? {});
    const peerToolSet = Object.fromEntries(
      peerEntries.map(([name, peer]) => [
        name,
        tool({
          description: peer.description,
          inputSchema: (peer.inputSchema ?? z.object({ input: z.string().describe("what to ask or tell the peer agent, in natural language") })) as never,
          execute: async (peerInput) => {
            const args = (peerInput ?? {}) as Record<string, unknown>;
            const guardFailure = peerMutationGuardFailure(name, input.question);
            if (guardFailure) {
              const result = `ERROR: ${guardFailure}`;
              input.onPeerAction?.(name, args, result);
              return result;
            }
            const result = await caught(() => (peer.inputSchema ? peer.run(args) : peer.run(String(args.input ?? ""))));
            input.onPeerAction?.(name, args, result);
            return result;
          },
        }),
      ]),
    );

    const briefingExtras = [
      taskTools
        ? "You CAN act on explicit tasking instructions using tools: capture_note files notes, digest_backlog/run digest mines structured backlog candidates, create_issue and label_issue manage GitHub issues, edit_issue revises an existing ticket in place (body, title, labels, comment, or non-gated status) so you never close-and-recreate just to change a ticket, query_backlog reports open backlog/status, queue_execution mints and queues a runnable execution ticket for Epaminon, and service_backlog selects eligible work without launching a runner. propose_vault_task plans vault work (read-only); after the user approves the plan, execute_vault_task carries it out and commits. Never execute vault writes without explicit approval; creating a GitHub issue is allowed when the user explicitly asks to create/open/file one. Tickets you create are worked by autonomous agents, so they must be runnable: every issue needs an objective, explicit scope, and a done-condition/acceptance criteria (plus the files for code work, or the exact action + execute-vs-draft for action tasks like posting). If the user's request lacks any of that, ask ONE short clarifying question and do not file the issue until it is runnable — never create a ticket that would just bounce back as needs-clarification. Creating an issue does NOT run it: a ticket only executes once queue_execution mints a linked type:execution ticket and dispatches it to Epaminon. So when the user asks to create AND queue/run a ticket, create_issue then queue_execution with the newly created qualified issue id in the same turn. If the user asks to run a planning ticket and the runnable context is clear, queue a runnable execution ticket; if the context is not clear, ask ONE exact clarifying question. Never ask for a magic phrase. Never tell the user something is 'queued', 'running', 'picked up', or 'did not run' unless queue_execution just succeeded or a live execution_status result confirms it this turn. For status questions like 'did it run?', 'was it picked up?', 'did issue 108 run?', or 'what is #N doing?', call execution_status when that tool is available; pass the user's exact issue/execution reference even if it is unqualified. query_backlog alone is not enough to confirm runner pickup. Never say you searched, checked, verified, or looked up execution state unless the same reply has a successful execution_status tool action. If execution_status says there is no execution ticket for the issue the user named, lead with that fact; do not infer execution, completion, PRs, or changed files for that issue from GitHub issue body text, comments, child-ticket notes, or narrative history. You may mention related child tickets or PRs only as related issue narrative, clearly separated from whether the original issue itself ran. Whenever you report an issue or execution ticket, render it as a clickable markdown link using the GitHub URL."
        : "",
      taskTools
        ? "VOICE NOTES: channel adapters transcribe voice notes before they reach you. Treat transcribed speech EXACTLY as if the user typed those words. Your visible reply MUST be your substantive response to what they actually said — a question gets an answer, a request gets acted on, a remark gets a real reply. NEVER reply with only a filing/queue acknowledgment such as 'Queued for filing', 'Queued', 'Queued (voice note transcript)', or 'Filed' — for a voice note that is a failure, not a reply. Separately and silently, ONLY if the note carries substantive content worth remembering later (a decision, idea, plan, commitment, or fact), you MAY also call capture_note to keep it — but capturing is a background side-effect and must NEVER replace or become your reply. Ephemeral notes (quick questions, chit-chat, one-off instructions you've handled) are not filed. The transcript stays in the conversation either way."
        : "",
      driveTools
        ? "The user's Google Drive is connected: list_drive_files shows what is waiting in the inbox; ingest_drive_file queues one file for background transcription (download, configured transcription provider for audio, filing, archiving). When the user asks to transcribe their Drive files or voice notes, list first, then call ingest_drive_file for each relevant file. It returns immediately — tell the user the files are queued and processing in the background, that live progress is in the Transcription panel, and the transcripts land in the vault when done."
        : "",
      peerEntries.length
        ? `You have tools from connected peer agents (the mesh): ${peerEntries
            .map(([name]) => name)
            .join(", ")}. They reach capabilities you do NOT hold locally — above all the user's memory/vault (search it, read it, ask about it, add to it). Use them to answer anything about the user's notes/knowledge or to remember something for them; prefer them over saying you can't help. add_memory is async — say it's queued, not stored, unless confirmed.`
        : "",
    ].filter(Boolean);

    // Tell the model its tool budget so it plans instead of getting silently
    // guillotined mid-loop. The last step forces a text answer (prepareStep
    // below), so usable tool-calling rounds = maxSteps - 1.
    const toolRounds = Math.max(1, this.maxSteps - 1);
    const budgetNote = [
      `TOOL BUDGET: you have at most ${toolRounds} round${toolRounds === 1 ? "" : "s"} of tool calls this turn, then you MUST write your final answer.`,
      "Plan accordingly: search and read early, ask for everything you need up front rather than one tool at a time, and never spend your last round on a tool call.",
      "If you are near the limit, stop gathering and answer with what you have — a clearly-caveated partial answer always beats no answer.",
    ].join(" ");
    const systemText = [input.vaultBriefing, ...briefingExtras, budgetNote].filter(Boolean).join("\n\n");
    const config = {
      model: this.model(this.askModelId),
      // System prefix as a cached message rather than top-level `system`, so the
      // (large, stable) vault briefing is reused across turns instead of re-billed.
      messages: [
        { role: "system", content: systemText, providerOptions: this.cacheBreakpoint },
        ...messages,
      ] as ModelMessage[],
      stopWhen: stepCountIs(this.maxSteps),
      // Hard guarantee against the empty-reply failure: on the final step,
      // disable tools so the model is forced to produce text from what it has.
      // It can plan around this because the budget is in its system prompt.
      prepareStep: ({ stepNumber }: { stepNumber: number }) =>
        stepNumber >= this.maxSteps - 1 ? { toolChoice: "none" as const } : {},
      tools: {
        ...taskToolSet,
        ...driveToolSet,
        ...peerToolSet,
        // Vault tools are registered only when the agent actually has a vault
        // (they arrive as a group). A vaultless agent (the Console) omits them, so
        // the model never advertises a tool it can't run.
        ...(tools.searchVault
          ? {
              search_vault: tool({
                description:
                  "Search the vault. Call this first for any question about the user's knowledge — returns ranked paths with snippets. Covers meaning pages, Log/ evidence files (verbatim transcripts, source links), and _attachments/ artifact filenames. If the first query misses, retry with different terms before giving up.",
                inputSchema: z.object({ query: z.string() }),
                execute: ({ query }) => tools.searchVault!(query),
              }),
              read_note: tool({
                description:
                  "Read the full content of one note by its vault-relative path. Works on meaning pages and Log/ evidence files. Always read the top search hits in full before concluding the vault lacks an answer — bodies hold details (transcripts, source links, '## Sources' sections) that summaries omit.",
                inputSchema: z.object({ path: z.string() }),
                execute: async ({ path }) => {
                  readPaths.add(path);
                  return tools.readNote!(path);
                },
              }),
              list_pages: tool({
                description: "List all meaning pages with their titles, tags, and summaries.",
                inputSchema: z.object({}),
                execute: () => tools.listPages!(),
              }),
            }
          : {}),
        search_chats: tool({
          description:
            "Search your past conversations with the user across ALL channels (WhatsApp, web, CLI, MCP) — not just the current thread. Returns matching messages grouped by conversation, with channel and timestamp. Use this when the user refers to something said earlier ('the issue we discussed', 'we were speaking about…', 'what did I say yesterday'), especially when it may have happened on a different channel. This is conversation history, distinct from search_vault (durable notes); reach for both when either could hold the answer.",
          inputSchema: z.object({ query: z.string() }),
          execute: ({ query }) => tools.searchChats(query),
        }),
      },
    };

    if (input.onTextDelta || input.onToolEvent) {
      // Stream the full event chain so tool calls surface as live activity —
      // not just text. The loop still runs every tool to completion before the
      // stream ends, so the turn finishes only once the work is done.
      const result = streamText(config);
      let text = "";
      let reasoning = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          input.onTextDelta?.(part.text);
        } else if (part.type === "reasoning-delta") {
          // Reasoning is internal and never shown, but tracked so an
          // empty-text recovery can report how much thinking was discarded.
          reasoning += part.text;
        } else if (part.type === "tool-call") {
          // readPaths is tracked by the read_note tool's execute wrapper below.
          input.onToolEvent?.({ phase: "start", tool: part.toolName, label: toolLabel(part.toolName, part.input) });
        } else if (part.type === "tool-result") {
          input.onToolEvent?.({ phase: "end", tool: part.toolName, label: toolLabel(part.toolName, part.input) });
        } else if (part.type === "tool-error") {
          input.onToolEvent?.({ phase: "error", tool: part.toolName, label: toolLabel(part.toolName, part.input) });
        } else if (part.type === "error") {
          // The provider failed mid-stream (bad key, out of quota, rate limit).
          // fullStream surfaces this as a part rather than throwing — re-throw
          // so the turn ends with a visible error instead of hanging on an
          // empty "Working…" bubble.
          const err = (part as { error?: unknown }).error;
          throw err instanceof Error ? err : new Error(extractErrorMessage(err));
        }
      }
      this.reportUsage("answer", this.askModelId, await result.totalUsage, await result.providerMetadata);
      if (!text.trim()) {
        const response = await result.response;
        text = await this.recoverEmptyAnswer(
          config.model,
          config.messages,
          response.messages,
          reasoning,
          input.onTextDelta,
        );
      }
      return { text, readPaths: [...readPaths] };
    }

    const result = await generateText(config);
    this.reportUsage("answer", this.askModelId, result.totalUsage, result.providerMetadata);
    let text = result.text;
    if (!text.trim()) {
      text = await this.recoverEmptyAnswer(
        config.model,
        config.messages,
        result.response.messages,
        result.reasoningText ?? "",
      );
    }
    return { text, readPaths: [...readPaths] };
  }

  async work(input: WorkLoopInput, tools: VaultReadTools, writeTools?: VaultWriteTools): Promise<WorkLoopResult> {
    const executing = writeTools !== undefined;

    const system = [
      input.vaultBriefing,
      executing
        ? [
            "MODE: EXECUTE. Carry out the approved plan below against the vault, using the write tools.",
            "Hard rules:",
            "- Log/ and _attachments/ are immutable evidence — never write, move, or delete there (tools will reject it).",
            "- Meaning pages (Projects/, Areas/, Notes/) need valid frontmatter: title, type (project|area|note matching the folder), tags, created, updated, summary. New pages should also include OKF-compatible description and timestamp fields.",
            "- When you move or rename a page, update wikilinks that point to it by full path.",
            "- Stay within the plan; skip a step (and say so) rather than improvising a different change.",
            "- The engine validates and commits when you finish — do not narrate git operations.",
            "When done, reply with ONE LINE summarizing what you did (it becomes the commit message), then the details.",
          ].join("\n")
        : [
            "MODE: PROPOSE. Survey the vault and produce a concrete, reviewable plan for the objective — do NOT describe generic advice.",
            "List every operation explicitly, one per line: move/delete/write with exact vault-relative paths and a one-line rationale each.",
            "Log/ and _attachments/ are immutable evidence — never plan changes there.",
            "If an item's fate is genuinely ambiguous, put it under an 'ASK THE USER' heading with the question.",
          ].join("\n"),
    ].join("\n\n");

    // The work loop only runs with a vault, so the (now-optional) vault read tools
    // are always present here.
    const readToolSet = {
      search_vault: tool({
        description: "Search the vault — ranked paths with snippets.",
        inputSchema: z.object({ query: z.string() }),
        execute: ({ query }) => caught(() => tools.searchVault!(query)),
      }),
      read_note: tool({
        description: "Read the full content of one note by its vault-relative path.",
        inputSchema: z.object({ path: z.string() }),
        execute: ({ path }) => caught(() => tools.readNote!(path)),
      }),
      list_pages: tool({
        description: "List all meaning pages with titles, tags, and summaries.",
        inputSchema: z.object({}),
        execute: () => caught(() => tools.listPages!()),
      }),
    };

    const writeToolSet = writeTools
      ? {
          list_files: tool({
            description: "List every file in the vault (markdown and attachments), one path per line.",
            inputSchema: z.object({}),
            execute: () => caught(() => writeTools.listFiles()),
          }),
          write_note: tool({
            description: "Create or fully rewrite one file in the working tree (vault-relative path).",
            inputSchema: z.object({ path: z.string(), content: z.string() }),
            execute: ({ path, content }) => caught(() => writeTools.writeNote(path, content)),
          }),
          move_note: tool({
            description: "Move/rename one file in the working tree. Update inbound full-path wikilinks afterwards.",
            inputSchema: z.object({ from: z.string(), to: z.string() }),
            execute: ({ from, to }) => caught(() => writeTools.moveNote(from, to)),
          }),
          delete_note: tool({
            description: "Delete one file from the working tree.",
            inputSchema: z.object({ path: z.string() }),
            execute: ({ path }) => caught(() => writeTools.deleteNote(path)),
          }),
        }
      : {};

    const promptText = [
      `Objective: ${input.objective}`,
      input.plan ? `Approved plan:\n${input.plan}` : "",
      input.previousErrors?.length
        ? `Your previous attempt failed validation — fix ALL of these in the working tree:\n${input.previousErrors
            .map((e) => `- ${e.path} [${e.rule}] ${e.message}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await generateText({
      model: this.model(this.askModelId),
      // Cache the briefing-laden system prefix: propose and execute (plus any
      // execute retries) run back-to-back with the same briefing → cache reads.
      messages: [
        { role: "system", content: system, providerOptions: this.cacheBreakpoint },
        { role: "user", content: promptText },
      ] as ModelMessage[],
      stopWhen: stepCountIs(MAX_WORK_STEPS),
      tools: { ...readToolSet, ...writeToolSet },
    });
    this.reportUsage("work", this.askModelId, result.totalUsage, result.providerMetadata);

    return { text: result.text };
  }
}

export function createBrainLlm(options: AiLlmOptions): BrainLlm {
  return new AiSdkBrainLlm(options);
}
