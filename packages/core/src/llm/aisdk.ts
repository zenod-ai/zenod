import { generateObject, generateText, stepCountIs, streamText, tool, type ModelMessage } from "ai";
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
  DriveSourceTools,
  VaultReadTools,
  VaultTaskTools,
  VaultWriteTools,
  WorkLoopInput,
  WorkLoopResult,
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
const MAX_WORK_STEPS = 40;

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
    case "list_drive_files":
      return "Listing your Google Drive";
    case "ingest_drive_file":
      return "Ingesting a Google Drive file — downloading, transcribing, filing";
    case "propose_vault_task":
      return "Planning vault changes";
    case "execute_vault_task":
      return "Reorganizing the vault";
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
        "- YAML frontmatter with exactly these keys: title, type, tags, created, updated (YYYY-MM-DD), summary (one dense line written for a cold LLM reader).",
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

    return text.replace(/^```(?:markdown|md)?\n/, "").replace(/\n```\s*$/, "").trimEnd() + "\n";
  }

  async answer(
    input: AnswerInput,
    tools: VaultReadTools,
    taskTools?: VaultTaskTools,
    driveTools?: DriveSourceTools,
  ): Promise<AnswerResult> {
    const readPaths = new Set<string>();
    const messages: ModelMessage[] = [
      ...input.conversation.map((m): ModelMessage => ({ role: m.role, content: m.text })),
      { role: "user", content: input.question },
    ];

    const taskToolSet = taskTools
      ? {
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
              "Download one Google Drive file by its file ID (from list_drive_files) and ingest it into the vault through the librarian pipeline: audio voice notes (m4a, mp3, ogg, wav) are transcribed first; the transcript lands as immutable evidence with a link back to the Drive file, then gets filed onto the right meaning page(s) and committed. After a successful ingest the file is moved out of the inbox into the Archive/ subfolder in Drive (its link stays valid). Returns a filing report (evidence ref, pages touched, commit, archive status). Ingest ONE file per call; report each result to the user as you go.",
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

    const briefingExtras = [
      taskTools
        ? "You CAN reorganize the vault: propose_vault_task plans the work (read-only); after the user approves the plan, execute_vault_task carries it out and commits. Never execute without showing the plan and getting an explicit yes first."
        : "",
      driveTools
        ? "The user's Google Drive is connected: list_drive_files shows what is there; ingest_drive_file downloads one file (transcribing audio voice notes) and files it into the vault as evidence + meaning. When the user asks to ingest their Drive files or voice notes, list first, then ingest each relevant file and report the filing results."
        : "",
    ].filter(Boolean);

    const config = {
      model: this.model(this.askModelId),
      system: briefingExtras.length > 0 ? `${input.vaultBriefing}\n\n${briefingExtras.join("\n\n")}` : input.vaultBriefing,
      messages,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: {
        ...taskToolSet,
        ...driveToolSet,
        search_vault: tool({
          description:
            "Search the vault. Call this first for any question about the user's knowledge — returns ranked paths with snippets. Covers meaning pages, Log/ evidence files (verbatim transcripts, source links), and _attachments/ artifact filenames. If the first query misses, retry with different terms before giving up.",
          inputSchema: z.object({ query: z.string() }),
          execute: ({ query }) => tools.searchVault(query),
        }),
        read_note: tool({
          description:
            "Read the full content of one note by its vault-relative path. Works on meaning pages and Log/ evidence files. Always read the top search hits in full before concluding the vault lacks an answer — bodies hold details (transcripts, source links, '## Sources' sections) that summaries omit.",
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
    };

    if (input.onTextDelta || input.onToolEvent) {
      // Stream the full event chain so tool calls surface as live activity —
      // not just text. The loop still runs every tool to completion before the
      // stream ends, so the turn finishes only once the work is done.
      const result = streamText(config);
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          input.onTextDelta?.(part.text);
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
      return { text, readPaths: [...readPaths] };
    }

    const { text } = await generateText(config);
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
            "- Meaning pages (Projects/, Areas/, Notes/) need valid frontmatter: title, type (project|area|note matching the folder), tags, created, updated, summary.",
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

    const readToolSet = {
      search_vault: tool({
        description: "Search the vault — ranked paths with snippets.",
        inputSchema: z.object({ query: z.string() }),
        execute: ({ query }) => caught(() => tools.searchVault(query)),
      }),
      read_note: tool({
        description: "Read the full content of one note by its vault-relative path.",
        inputSchema: z.object({ path: z.string() }),
        execute: ({ path }) => caught(() => tools.readNote(path)),
      }),
      list_pages: tool({
        description: "List all meaning pages with titles, tags, and summaries.",
        inputSchema: z.object({}),
        execute: () => caught(() => tools.listPages()),
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

    const { text } = await generateText({
      model: this.model(this.askModelId),
      system,
      prompt: [
        `Objective: ${input.objective}`,
        input.plan ? `Approved plan:\n${input.plan}` : "",
        input.previousErrors?.length
          ? `Your previous attempt failed validation — fix ALL of these in the working tree:\n${input.previousErrors
              .map((e) => `- ${e.path} [${e.rule}] ${e.message}`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      stopWhen: stepCountIs(MAX_WORK_STEPS),
      tools: { ...readToolSet, ...writeToolSet },
    });

    return { text };
  }
}

export function createBrainLlm(options: AiLlmOptions): BrainLlm {
  return new AiSdkBrainLlm(options);
}
