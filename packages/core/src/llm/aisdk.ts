import { generateObject, generateText, stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
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
      return "Queuing a Google Drive file for ingestion";
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

  async extractBacklog(input: BacklogExtractInput): Promise<BacklogExtractResult> {
    const { object } = await generateObject({
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
              "Create a GitHub issue when the user asks to create/open/file an issue. Agent-created issues are proposals only: use status:proposed, never status:queued. Use the configured repository unless the user specifies another owner/repo. Return the issue URL to the user.",
            inputSchema: z.object({
              repo: z.string().nullable().describe("owner/repo target; null uses the configured vault/project repo"),
              title: z.string().describe("issue title"),
              body: z.string().describe("issue body with context and acceptance criteria"),
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
          query_backlog: tool({
            description:
              "Return real status for open backlog/issues. Use when the user asks where things stand, open issue status, backlog status, blockers, or what is ready next.",
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
              "Queue one Google Drive file (by file ID from list_drive_files) for background ingestion: it downloads, transcribes audio voice notes with the configured transcription provider (Groq when set, otherwise local whisper.cpp), files the transcript into the vault as evidence + meaning, commits, and archives the original — all in a background worker that survives the user navigating away. Returns immediately with the job id and status; it does NOT wait for completion. Call once per file. Tell the user the files are queued/processing and that live progress is in the Ingestion panel (Connections tab).",
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
        ? "You CAN act on explicit tasking instructions using tools: capture_note files notes, digest_backlog/run digest mines structured backlog candidates, create_issue and label_issue manage GitHub issues, query_backlog reports open backlog/status, and service_backlog selects eligible work without launching a runner. propose_vault_task plans vault work (read-only); after the user approves the plan, execute_vault_task carries it out and commits. Never execute vault writes without explicit approval; creating a GitHub issue is allowed when the user explicitly asks to create/open/file one."
        : "",
      driveTools
        ? "The user's Google Drive is connected: list_drive_files shows what is waiting in the inbox; ingest_drive_file queues one file for background ingestion (download, configured transcription provider for audio, filing, archiving). When the user asks to ingest their Drive files or voice notes, list first, then call ingest_drive_file for each relevant file. It returns immediately — tell the user the files are queued and processing in the background, that live progress is in the Ingestion panel (Connections tab), and the transcripts land in the vault when done."
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
