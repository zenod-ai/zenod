import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type {
  Answer,
  BacklogCandidate,
  BacklogDigestInput,
  BacklogDigestResult,
  BacklogSourceRef,
  BrainEngine,
  ChatOptions,
  ExternalTaskingTools,
  Hit,
  LintReport,
  Note,
  Reply,
  StateStore,
  StoreInput,
  StoreResult,
  Surface,
  TaskingAction,
  TaskingReply,
  TaskingSurface,
  TokenCostMeasurement,
  TokenCostOperation,
  WorkInput,
  WorkResult,
} from "../types.js";
import { loadBrainConfig } from "../vault/config.js";
import { checkEvidenceImmutability } from "../vault/immutability.js";
import { lintVault } from "../vault/lint.js";
import { scanVault } from "../vault/pages.js";
import { githubUrl, type VaultLocation } from "../vault/github.js";
import { getNote } from "../ops/get.js";
import { searchVault } from "../ops/search.js";
import { WriteQueue, type QueuePriority } from "../git/queue.js";
import type { VaultRepo } from "../git/vaultRepo.js";
import type { BrainLlm, ChatToolEvent, Classification, DriveSourceTools, PeerTools, VaultReadTools, VaultTaskTools } from "../llm/types.js";
import { appendEvidence, todayString } from "./evidence.js";
import { listAttachmentFiles, MEANING_FOLDERS } from "../vault/files.js";
import { normalizeCreateIssueLabels, normalizeLabelIssueLabels, summarizeActionsForReply } from "../taskingPolicy.js";

/**
 * The conversation key for a surface. One continuous thread per surface today;
 * the `default:` prefix leaves room for multi-session later.
 */
export function conversationId(surface: Surface, key = "default"): string {
  const safeKey = key.trim().replace(/[^\w@.+:-]/g, "_").slice(0, 160) || "default";
  return `${surface}:${safeKey}`;
}

/** Human-readable channel name for chat-search results. */
function channelName(surface: Surface): string {
  switch (surface) {
    case "whatsapp":
      return "WhatsApp";
    case "telegram":
      return "Telegram";
    case "web":
      return "Web chat";
    case "mcp":
      return "MCP";
    case "cli":
      return "CLI";
    case "drive":
      return "Drive";
    case "selftest":
      return "Self-test";
    default:
      return surface;
  }
}

function formatChatTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function chatSnippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

export interface EngineOptions {
  /**
   * The vault repo. Optional: when omitted the engine runs "vaultless" — no
   * sync, no vault briefing, no vault read/write tools — for the Console shell
   * (the suite's base minus the vault capability). Vault-only methods (store,
   * work, ask, search, get, lint, digestBacklog) throw a clear error in that
   * mode; chat/handleTasking run with a persona-only briefing.
   */
  repo?: VaultRepo;
  llm: BrainLlm;
  state: StateStore;
  location?: VaultLocation;
  /** System persona for the ask/chat loop. Defaults to Zenod's if omitted. */
  persona?: string;
  /**
   * External-source tools (Google Drive) exposed to the chat loop. Provided
   * by the server when a Drive connection is configured; the engine itself
   * stays source-agnostic.
   */
  driveTools?: DriveSourceTools;
  /**
   * External tasking tools exposed through handleTasking/chat. Server adapters
   * provide GitHub/backlog integrations; core supplies conservative fallbacks.
   */
  taskingTools?: ExternalTaskingTools;
  /**
   * Peer-agent delegation tools (the mesh). Each is exposed to the chat loop as
   * a tool (e.g. `ask_zenod`) that forwards to a peer agent and returns its
   * answer. Server-provided from configured peers; the engine stays peer-agnostic.
   */
  peerTools?: PeerTools;
  /** Override for tests. */
  now?: () => Date;
  /**
   * Max staleness the read path tolerates before pulling from origin.
   * Writes always pull; without this, reads could serve a stale snapshot
   * indefinitely. 0 = pull on every read (tests).
   */
  readSyncTtlMs?: number;
  /**
   * Optional LLM cost instrumentation. Estimates are based on prompt text
   * before the provider call; provider-side tool schema overhead and billing
   * tokenizers may differ, but the briefing share is measured consistently.
   */
  onTokenCost?: (measurement: TokenCostMeasurement) => void;
}

// One retry, not two: attempt 0 composes, attempt 1 re-composes with the lint
// errors fed back (the high-value correction). A third attempt rarely recovers
// what the second didn't and just adds a full compose round-trip per page to the
// worst case — costly on long, multi-page stores. On exhaustion we fall back to
// an Inbox stub, so a hard case is parked for the user, never half-applied.
const COMPOSE_RETRIES = 1;
const WORK_RETRIES = 2;
const DEFAULT_READ_SYNC_TTL_MS = 60_000;
const MAX_BRIEFING_MEANING_PAGES = 80;
const MAX_BRIEFING_LOG_FILES = 20;
const MAX_BRIEFING_ATTACHMENTS = 40;
const MAX_BRIEFING_SUMMARY_CHARS = 240;

const DEFAULT_TEMPLATE = `---
title: "{{title}}"
type: {{type}}
tags: []
created: "{{date}}"
updated: "{{date}}"
summary: ""
description: ""
timestamp: "{{date}}T00:00:00Z"
---

# {{title}}
`;

interface Briefing {
  text: string;
  estimatedTokens: number;
  chars: number;
  sections: NonNullable<TokenCostMeasurement["briefingSections"]>;
}

export function createEngine(options: EngineOptions): BrainEngine {
  const { repo, llm, state } = options;
  // Vaultless mode (Console shell): no repo → vaultPath is empty and every vault
  // touchpoint below guards on `repo`. assertVault() gates the vault-only methods.
  const vaultPath = repo ? repo.path : "";
  // Assertion (not just a throw) so TS narrows `repo` to VaultRepo for the rest of
  // a vault-only method after the guard, keeping `repo.pull()` etc. well-typed.
  function assertVault(value: VaultRepo | undefined): asserts value is VaultRepo {
    if (!value) throw new Error("This agent has no vault configured — vault operations are unavailable.");
  }
  const location = options.location ?? {};
  const now = options.now ?? (() => new Date());
  const queue = new WriteQueue();
  const readSyncTtl = options.readSyncTtlMs ?? DEFAULT_READ_SYNC_TTL_MS;
  let lastSyncMs = Number.NEGATIVE_INFINITY;

  /**
   * Keep the read path fresh: pull from origin (throttled by readSyncTtl)
   * before serving a read. Runs through the write queue so a pull never
   * rebases over a store's half-written working tree. Offline is fine —
   * reads then serve the local clone, same as store's pull fallback.
   */
  async function syncForRead(): Promise<void> {
    if (!repo) return; // vaultless: nothing to pull
    if (now().getTime() - lastSyncMs < readSyncTtl) return;
    // Never block an interactive turn on a best-effort freshness pull. If a
    // write is in flight (especially a slow background librarian filing), serve
    // the local clone now and sync on a later read — blocking here let
    // background filing stall replies for minutes (#96). lastSyncMs is left
    // untouched so the next idle read retries the pull.
    if (queue.busy) return;
    await queue.run(async () => {
      if (now().getTime() - lastSyncMs < readSyncTtl) return; // a queued turn already synced
      await repo.pull().catch(() => {});
      lastSyncMs = now().getTime();
    });
  }

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  function truncateInline(value: string, maxChars: number): string {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars - 12).trimEnd()} [truncated]`;
  }

  function reportTokenCost(
    operation: TokenCostOperation,
    parts: string[],
    briefing?: Briefing,
    stage?: string,
  ): void {
    options.onTokenCost?.({
      operation,
      ...(stage ? { stage } : {}),
      estimatedInputTokens: estimateTokens(parts.join("\n\n")),
      estimatedBriefingTokens: briefing?.estimatedTokens ?? 0,
      briefingChars: briefing?.chars ?? 0,
      ...(briefing ? { briefingSections: briefing.sections } : {}),
    });
  }

  async function vaultBriefing(): Promise<Briefing> {
    if (!repo) {
      // Vaultless (Console shell): no vault to map and no TOOL CONTRACT to enforce —
      // just the persona. The chat loop runs as plain assistant chat.
      const text = options.persona ?? "You are a helpful assistant. Be direct and concise.";
      const empty = { included: 0, total: 0, omitted: 0 };
      return {
        text,
        estimatedTokens: estimateTokens(text),
        chars: text.length,
        sections: { meaningPages: empty, evidenceLogs: empty, attachments: empty },
      };
    }
    const agents = await readFile(join(vaultPath, "AGENTS.md"), "utf8").catch(() => "");
    const snapshot = await scanVault(vaultPath);
    const allLogFiles = snapshot.files.filter((f) => f.startsWith("Log/"));
    const allAttachmentFiles = await listAttachmentFiles(vaultPath);
    const meaningPages = snapshot.pages.slice(0, MAX_BRIEFING_MEANING_PAGES);
    const logFiles = allLogFiles.slice(-MAX_BRIEFING_LOG_FILES);
    const attachmentFiles = allAttachmentFiles.slice(-MAX_BRIEFING_ATTACHMENTS);
    const index = meaningPages
      .map((p) => `${p.path} — ${p.title} [${p.tags.join(",")}]: ${truncateInline(p.summary, MAX_BRIEFING_SUMMARY_CHARS)}`)
      .join("\n");
    const logs = logFiles.join("\n");
    const attachments = attachmentFiles.join("\n");
    const sections: Briefing["sections"] = {
      meaningPages: {
        included: meaningPages.length,
        total: snapshot.pages.length,
        omitted: Math.max(0, snapshot.pages.length - meaningPages.length),
      },
      evidenceLogs: {
        included: logFiles.length,
        total: allLogFiles.length,
        omitted: Math.max(0, allLogFiles.length - logFiles.length),
      },
      attachments: {
        included: attachmentFiles.length,
        total: allAttachmentFiles.length,
        omitted: Math.max(0, allAttachmentFiles.length - attachmentFiles.length),
      },
    };
    const text = [
      options.persona ?? "You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.",
      // The index below is a map, not the territory — a weaker model will happily
      // answer from it and skip the tools. Make tool use a hard, non-negotiable
      // contract so search_vault/read_note actually fire on every vault question.
      [
        "TOOL CONTRACT — applies to every question about the vault's contents, no exceptions:",
        "1. You MUST call search_vault BEFORE you write any answer. Do not narrate 'let me search' and then answer — actually call the tool first, then answer from its results.",
        "2. You MUST call read_note on the notes/logs you rely on before quoting, summarizing, or citing them. Never describe a note's contents from its title or summary alone.",
        "3. The page/log/attachment lists in this briefing are ONLY a table of contents so you know what to search for and read. They are NOT a source you may quote, count, rank, or answer from. Anything you state about vault content must come from a tool result in THIS turn.",
        "4. To conclude something is absent, you must have run search_vault (and retried with different terms) this turn — never infer absence from this index.",
        "The only questions exempt are pure chit-chat with no reference to the user's notes, projects, logs, or memory.",
      ].join("\n"),
      "The vault has two tiers. Meaning pages (Projects/, Areas/, Notes/) hold distilled knowledge. The evidence tier holds the originals: Log/ daily files contain immutable receipts — verbatim transcripts, quotes, and source links (e.g. Google Drive URLs) — and _attachments/ holds raw artifacts (images, documents).",
      "For provenance questions (where is the original / audio / transcript / source?), read the Log file bodies and the '## Sources' section of meaning pages — that is where artifact locations live.",
      "Summaries are lossy. Before concluding something is not in the vault, read the full bodies of the top search hits, and search again with different terms.",
      "Cite sources inline as vault paths. Be direct and concise.",
      "Beyond the vault, you can call search_chats to search your own past conversations with the user across every channel (WhatsApp, web, CLI, MCP) — not just this thread. Use it when the user refers to something discussed earlier ('the issue we talked about', 'we were speaking about…', 'what did I say yesterday'), especially when it may have happened on a different channel than the one you're replying on. The current thread's recent turns are already in context; search_chats reaches older turns and other channels. The vault holds durable knowledge; chats are the running conversation — check both when a question could be answered by either.",
      agents ? `Vault doctrine:\n${agents}` : "",
      `MAP — meaning pages (${meaningPages.length}/${snapshot.pages.length}). A table of contents only; call search_vault/read_note to use any of these, and search_vault to reach the omitted ones:\n${index || "(none yet)"}`,
      `MAP — recent evidence logs (${logFiles.length}/${allLogFiles.length}). Filenames only; call read_note to see a log's contents, search_vault to reach older logs:\n${logs || "(none yet)"}`,
      `MAP — recent attachments (${attachmentFiles.length}/${allAttachmentFiles.length}). Paths only; search_vault reaches the omitted ones:\n${attachments || "(none yet)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { text, estimatedTokens: estimateTokens(text), chars: text.length, sections };
  }

  function readTools(): VaultReadTools {
    // searchChats is state-backed (conversation history), not vault-backed — it
    // works in every mode, so it is the one read tool a vaultless agent keeps.
    const searchChats = async (query: string) => {
      const hits = await state.searchConversations(query, { limit: 6 });
      if (hits.length === 0) return "no results";
      return hits
        .map((hit) => {
          const header = `[${channelName(hit.surface)}] ${hit.matchCount} matching message${
            hit.matchCount === 1 ? "" : "s"
          }, latest ${formatChatTimestamp(hit.lastAt)}`;
          const lines = hit.messages
            .map((m) => `  ${m.role === "user" ? "User" : "Zeno"} (${formatChatTimestamp(m.at)}): ${chatSnippet(m.text)}`)
            .join("\n");
          return `${header}\n${lines}`;
        })
        .join("\n\n");
    };
    // Vaultless (Console shell): omit the vault tools entirely so the loop never
    // advertises a tool it can't run. The LLM layer registers only what's present.
    if (!repo) return { searchChats };
    return {
      searchVault: async (query: string) => {
        const hits = await searchVault(vaultPath, query, location);
        if (hits.length === 0) return "no results";
        return hits.map((h) => `${h.path} (score ${h.score}) — ${h.snippet}`).join("\n");
      },
      readNote: async (path: string) => {
        const note = await getNote(vaultPath, path, location);
        const body = note.body.length > 8000 ? `${note.body.slice(0, 8000)}\n[truncated]` : note.body;
        return `--- frontmatter: ${JSON.stringify(note.frontmatter)}\n${body}`;
      },
      listPages: async () => {
        const snapshot = await scanVault(vaultPath);
        return snapshot.pages.map((p) => `${p.path} — ${p.title}: ${p.summary}`).join("\n") || "(none)";
      },
      searchChats,
    };
  }

  /** Vault-relative path guard for the work tools: no escapes, no evidence-tier writes. */
  function guardedPath(rel: string): string {
    const clean = normalize(rel).replaceAll("\\", "/");
    if (isAbsolute(clean) || clean.startsWith("..") || clean.startsWith(".git/")) {
      throw new Error(`path escapes the vault: ${rel}`);
    }
    if (clean.startsWith("Log/") || clean.startsWith("_attachments/")) {
      throw new Error(`evidence tier is immutable — ${clean} cannot be written, moved, or deleted`);
    }
    return clean;
  }

  function writeTools() {
    return {
      listFiles: async () => {
        const snapshot = await scanVault(vaultPath);
        const attachments = await listAttachmentFiles(vaultPath);
        return [...snapshot.files, ...attachments].sort().join("\n") || "(empty vault)";
      },
      writeNote: async (path: string, content: string) => {
        const clean = guardedPath(path);
        await mkdir(dirname(join(vaultPath, clean)), { recursive: true });
        await writeFile(join(vaultPath, clean), content.endsWith("\n") ? content : `${content}\n`);
        return `wrote ${clean}`;
      },
      moveNote: async (from: string, to: string) => {
        const cleanFrom = guardedPath(from);
        const cleanTo = guardedPath(to);
        await mkdir(dirname(join(vaultPath, cleanTo)), { recursive: true });
        await rename(join(vaultPath, cleanFrom), join(vaultPath, cleanTo));
        return `moved ${cleanFrom} -> ${cleanTo}`;
      },
      deleteNote: async (path: string) => {
        const clean = guardedPath(path);
        await rm(join(vaultPath, clean));
        return `deleted ${clean}`;
      },
    };
  }

  function shouldDigestForBacklog(input: StoreInput): boolean {
    if (input.source !== "drive" && input.source !== "whatsapp") return false;
    if (input.content.length > 1200) return true;
    return /\b(action|backlog|blocker|issue|launch|must|need(?:s|ed)?|next step|question|remember to|should|todo)\b/i.test(
      input.content,
    );
  }

  function slugifyTitle(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    return slug || "candidate";
  }

  function candidateMarkdown(candidate: BacklogCandidate): string {
    const sourceRefs = candidate.source_refs
      .map((ref) => `- ${ref.path}${ref.githubUrl ? ` — ${ref.githubUrl}` : ""}`)
      .join("\n");
    const list = (items: string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None stated");
    return [
      "---",
      `title: ${JSON.stringify(candidate.title)}`,
      "status: proposed",
      `type: ${candidate.type}`,
      `owner: ${candidate.owner}`,
      `priority: ${candidate.priority}`,
      `difficulty: ${candidate.difficulty}`,
      `target_repo: ${JSON.stringify(candidate.target_repo ?? "")}`,
      `labels: ${JSON.stringify(candidate.suggested_labels)}`,
      "---",
      "",
      `# ${candidate.title}`,
      "",
      candidate.summary,
      "",
      "## Context",
      candidate.context || "None stated",
      "",
      "## Acceptance Criteria",
      list(candidate.acceptance_criteria),
      "",
      "## Dependencies",
      list(candidate.dependencies),
      "",
      "## Open Questions",
      list(candidate.open_questions),
      "",
      "## Sources",
      sourceRefs || "- None",
      "",
    ].join("\n");
  }

  function ensureCandidateSources(candidates: BacklogCandidate[], sourceRefs: BacklogSourceRef[]): BacklogCandidate[] {
    return candidates.map((candidate) => ({
      ...candidate,
      source_refs: candidate.source_refs.length > 0 ? candidate.source_refs : sourceRefs,
    }));
  }

  async function collectBacklogSource(input: BacklogDigestInput): Promise<{ content: string; sourceRefs: BacklogSourceRef[] }> {
    if (input.rawText?.trim()) {
      return { content: input.rawText.trim(), sourceRefs: input.sourceRefs ?? [] };
    }

    if (input.memoryPath?.trim()) {
      const note = await getNote(vaultPath, input.memoryPath.trim(), location);
      return {
        content: note.body,
        sourceRefs: [{ path: note.path, githubUrl: note.githubUrl }],
      };
    }

    if (input.query?.trim()) {
      const hits = (await searchVault(vaultPath, input.query.trim(), location)).slice(0, 5);
      const notes = await Promise.all(hits.map((hit) => getNote(vaultPath, hit.path, location)));
      return {
        content: notes.map((note) => `# ${note.path}\n${note.body}`).join("\n\n"),
        sourceRefs: notes.map((note) => ({ path: note.path, githubUrl: note.githubUrl })),
      };
    }

    throw new Error("digestBacklog requires rawText, memoryPath, or query");
  }

  async function writeBacklogCandidates(candidates: BacklogCandidate[]): Promise<BacklogDigestResult["written"]> {
    const written: BacklogDigestResult["written"] = [];
    const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const path = `Backlog/${stamp}-${String(index + 1).padStart(2, "0")}-${slugifyTitle(candidate.title)}.md`;
      await mkdir(dirname(join(vaultPath, path)), { recursive: true });
      await writeFile(join(vaultPath, path), candidateMarkdown(candidate));
      written.push({ path, githubUrl: githubUrl(location, path), title: candidate.title });
    }
    return written;
  }

  async function digestBacklog(input: BacklogDigestInput): Promise<BacklogDigestResult> {
    assertVault(repo);
    if (input.write) {
      return queue.run(async () => {
        await repo.pull().catch(() => {});
        lastSyncMs = now().getTime();
        const source = await collectBacklogSource(input);
        const extracted = await llm.extractBacklog(source);
        const candidates = ensureCandidateSources(extracted.candidates, source.sourceRefs);
        if (candidates.length === 0) {
          return { candidates, written: [], skipped: [{ reason: "no backlog candidates found" }], source_refs: source.sourceRefs };
        }
        const written = await writeBacklogCandidates(candidates);
        await repo.commitAndPush(`backlog: propose ${candidates.length} item${candidates.length === 1 ? "" : "s"}`);
        return {
          candidates,
          written: written.map((item) => ({ ...item, githubUrl: item.githubUrl || githubUrl(location, item.path) })),
          skipped: [],
          source_refs: source.sourceRefs,
        };
      });
    }

    await syncForRead();
    const source = await collectBacklogSource(input);
    const extracted = await llm.extractBacklog(source);
    const candidates = ensureCandidateSources(extracted.candidates, source.sourceRefs);
    return {
      candidates,
      written: [],
      skipped: input.write === false ? [] : [{ reason: "write not requested; returned proposed candidates only" }],
      source_refs: source.sourceRefs,
    };
  }

  function formatDigestResult(result: BacklogDigestResult): string {
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
  }

  function defaultRepo(): string {
    return location.repo ?? "";
  }

  function noExternalTool(name: string): string {
    return `${name} is not configured for this engine instance.`;
  }

  function buildTaskTools(surface: Surface, record?: (action: TaskingAction) => void): VaultTaskTools {
    const recordAction = (tool: string, input: Record<string, unknown>, result: string) => {
      record?.({ tool, input, result });
    };
    // Mutation tools must leave a recorded action whether they succeed OR throw,
    // so the reply can be reconciled against what really happened — a failed
    // create must never be narratable as success. The error is still re-thrown
    // so the LLM tool layer surfaces it to the model as before.
    const runMutation = async (tool: string, input: Record<string, unknown>, run: () => Promise<string>): Promise<string> => {
      try {
        const result = await run();
        recordAction(tool, input, result);
        return result;
      } catch (err) {
        recordAction(tool, input, `ERROR: ${(err as Error).message}`);
        throw err;
      }
    };
    return {
      captureNote: async (content: string, hints?: string[]) => {
        if (!repo) {
          return { evidenceRef: "(no vault)", pagesTouched: [], commitSha: "(no vault)", githubUrls: [], queued: false };
        }
        // The librarian pipeline (classify → compose → digest → commit) must
        // never sit on the hot reply line: on a slow model it adds minutes
        // (a real WhatsApp turn took ~4 min, ~2:20 of it filing — see
        // docs/SESSION-LOG-FORENSICS.md). Kick it off in the background through
        // the same write queue (so writes still serialize) and return at once;
        // the reply confirms the note is *queued*, not committed. The filing
        // self-reports to the logs when it lands.
        void store({ content, source: surface, ...(hints?.length ? { hints } : {}) }, "background")
          .then((result) =>
            console.info(
              `[librarian] background filing complete: ${result.evidenceRef}` +
                (result.pagesTouched.length ? ` → ${result.pagesTouched.join(", ")}` : " → (inbox)") +
                ` @ ${result.commitSha}`,
            ),
          )
          .catch((err) => console.error(`[librarian] background filing failed: ${(err as Error).message}`));
        recordAction(
          "capture",
          { content, ...(hints?.length ? { hints } : {}) },
          "Queued: filing this note to the vault in the background (not yet committed).",
        );
        return { evidenceRef: "(queued)", pagesTouched: [], commitSha: "(queued)", githubUrls: [], queued: true };
      },
      proposeTask: async (objective: string) => {
        if (!repo) return "Vault tasks are unavailable on this agent (it has no vault).";
        const proposal = await work({ objective });
        recordAction("proposeVaultTask", { objective }, proposal.text);
        return proposal.text;
      },
      executeTask: async (objective: string, plan: string) => {
        if (!repo) return "Vault tasks are unavailable on this agent (it has no vault).";
        const executed = await work({ objective, plan });
        const text = [
          executed.mode === "failed" ? "FAILED (rolled back, nothing committed)" : "DONE",
          executed.text,
          ...(executed.commitSha ? [`commit: ${executed.commitSha}`] : []),
          ...(executed.changedPaths?.length ? [`changed: ${executed.changedPaths.join(", ")}`] : []),
        ].join("\n");
        recordAction("executeVaultTask", { objective, plan }, text);
        return text;
      },
      digestBacklog: async (input: BacklogDigestInput) => {
        if (!repo) {
          return {
            candidates: [],
            written: [],
            skipped: [{ reason: "Vault-backed digest is unavailable on this agent (it has no vault)." }],
            source_refs: [],
          } satisfies BacklogDigestResult;
        }
        const result = await digestBacklog(input);
        recordAction("runDigest", { ...input }, formatDigestResult(result));
        return result;
      },
      createIssue: async (input) => {
        // Stamp the chat channel this ticket was opened from (whatsapp/telegram)
        // as an `origin:` label, so the backlog monitor's later proactive pings
        // ("Codex working on #N", needs-review, blocked, merged) go back to the
        // SAME channel instead of always defaulting to WhatsApp. Only push-capable
        // chat surfaces are stamped; web/cli/mcp have no proactive channel and
        // fall back to the default notify target.
        const originLabels = surface === "whatsapp" || surface === "telegram" ? [`origin:${surface}`] : [];
        const normalized = { ...input, repo: input.repo || defaultRepo(), labels: normalizeCreateIssueLabels([...(input.labels ?? []), ...originLabels]) };
        return runMutation("createIssue", normalized, () =>
          options.taskingTools
            ? options.taskingTools.createIssue({
                title: normalized.title,
                body: normalized.body,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
                labels: normalized.labels,
              })
            : Promise.resolve(noExternalTool("createIssue")),
        );
      },
      labelIssue: async (input) => {
        const normalized = { ...input, repo: input.repo || defaultRepo(), labels: normalizeLabelIssueLabels(input.labels) };
        return runMutation("labelIssue", normalized, () =>
          options.taskingTools
            ? options.taskingTools.labelIssue({
                issueNumber: normalized.issueNumber,
                labels: normalized.labels,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
              })
            : Promise.resolve(noExternalTool("labelIssue")),
        );
      },
      // Revise an existing ticket in place. The underlying ExternalTaskingTools
      // (githubApp.editGithubIssue) normalizes labels and enforces the same
      // queue/merge gates as createIssue/labelIssue: this can never set
      // status:queued or status:approved-merge, so editing a ticket can revise
      // scope/body/status without escalating execution.
      editIssue: async (input) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("editIssue", normalized, () =>
          options.taskingTools
            ? options.taskingTools.editIssue({
                issueNumber: normalized.issueNumber,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
                ...(normalized.title !== undefined ? { title: normalized.title } : {}),
                ...(normalized.body !== undefined ? { body: normalized.body } : {}),
                ...(normalized.labelsAdd ? { labelsAdd: normalized.labelsAdd } : {}),
                ...(normalized.labelsRemove ? { labelsRemove: normalized.labelsRemove } : {}),
                ...(normalized.labelsSet ? { labelsSet: normalized.labelsSet } : {}),
                ...(normalized.comment ? { comment: normalized.comment } : {}),
                ...(normalized.status !== undefined ? { status: normalized.status } : {}),
                ...(normalized.state !== undefined ? { state: normalized.state } : {}),
                ...(normalized.stateReason !== undefined ? { stateReason: normalized.stateReason } : {}),
              })
            : Promise.resolve(noExternalTool("editIssue")),
        );
      },
      closeIssue: async (input) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("closeIssue", normalized, () =>
          options.taskingTools
            ? options.taskingTools.closeIssue({
                issueNumber: normalized.issueNumber,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
                ...(normalized.comment ? { comment: normalized.comment } : {}),
                ...(normalized.notPlanned ? { notPlanned: true } : {}),
              })
            : Promise.resolve(noExternalTool("closeIssue")),
        );
      },
      queryBacklog: async (query?: string) => {
        const result = options.taskingTools
          ? await options.taskingTools.queryBacklog(query)
          : formatDigestResult(await digestBacklog({ query: query || "open backlog and issue status" }));
        recordAction("queryBacklog", query ? { query } : {}, result);
        return result;
      },
      serviceBacklog: async (query?: string) => {
        const result = options.taskingTools
          ? await options.taskingTools.serviceBacklog(query)
          : ["Backlog servicing runner is not wired in this engine instance.", "Eligible set from backlog query:", await buildTaskTools(surface).queryBacklog(query)].join(
              "\n",
            );
        recordAction("serviceBacklog", query ? { query } : {}, result);
        return result;
      },
      // The ONLY path that sets status:queued — promotes proposed→queued on
      // explicit human approval relayed through chat (#58). No label
      // normalization (unlike createIssue/labelIssue, which can never queue);
      // promotion IS the approval.
      approveQueue: async (input: { repo: string; issueNumbers: number[] }) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("approveQueue", normalized, () =>
          options.taskingTools
            ? options.taskingTools.approveQueue({
                issueNumbers: normalized.issueNumbers,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
              })
            : Promise.resolve(noExternalTool("approveQueue")),
        );
      },
      // The ONLY path that sets status:approved-merge — promotes
      // needs-review→approved-merge on explicit human approval relayed through
      // chat. Zenod never merges; this just trips the gate the controller
      // (monitor) watches to merge the PR on green CI.
      approveMerge: async (input: { repo: string; issueNumbers: number[] }) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("approveMerge", normalized, () =>
          options.taskingTools
            ? options.taskingTools.approveMerge({
                issueNumbers: normalized.issueNumbers,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
              })
            : Promise.resolve(noExternalTool("approveMerge")),
        );
      },
    };
  }

  /**
   * The librarian work loop — propose (read-only plan) then execute (approved
   * plan, validated, one commit per objective). The model arranges the working
   * tree; this function guarantees what lands: lint + evidence immutability,
   * commit-and-push or full rollback. Same contract as store, wider verbs.
   */
  async function work(input: WorkInput): Promise<WorkResult> {
    assertVault(repo);
    if (!input.plan) {
      await syncForRead();
      const briefing = await vaultBriefing();
      reportTokenCost("work", [briefing.text, input.objective], briefing, "proposal");
      const result = await llm.work(
        { objective: input.objective, vaultBriefing: briefing.text },
        readTools(),
      );
      return { mode: "proposal", text: result.text, committed: false };
    }

    return queue.run(async (): Promise<WorkResult> => {
      await repo.pull().catch(() => {});
      lastSyncMs = now().getTime();

      const briefing = await vaultBriefing();
      let loopInput = {
        objective: input.objective,
        plan: input.plan,
        vaultBriefing: briefing.text,
      } as import("../llm/types.js").WorkLoopInput;

      for (let attempt = 0; attempt <= WORK_RETRIES; attempt++) {
        reportTokenCost(
          "work",
          [
            briefing.text,
            input.objective,
            input.plan ?? "",
            ...(loopInput.previousErrors?.map((e) => `${e.path} [${e.rule}] ${e.message}`) ?? []),
          ],
          briefing,
          attempt === 0 ? "execute" : "retry",
        );
        const result = await llm.work(loopInput, readTools(), writeTools());

        const changes = await repo.pendingChanges();
        if (changes.length === 0) {
          return { mode: "executed", text: result.text, committed: false, changedPaths: [] };
        }

        const lintTargets = changes.filter((c) => c.path.endsWith(".md") && c.after !== null).map((c) => c.path);
        const report = await lintVault(vaultPath, lintTargets);
        const errors = [...report.errors, ...checkEvidenceImmutability(changes)];

        if (errors.length === 0) {
          const summary = result.text.split("\n")[0]?.slice(0, 120) || input.objective.slice(0, 120);
          const sha = await repo.commitAndPush(`work: ${summary}`);
          const changedPaths = changes.map((c) => c.path);
          return {
            mode: "executed",
            text: result.text,
            committed: true,
            commitSha: sha,
            changedPaths,
            githubUrls: changedPaths.map((p) => githubUrl(location, p)).filter(Boolean),
          };
        }

        if (attempt === WORK_RETRIES) {
          await repo.discardChanges();
          return {
            mode: "failed",
            text: `rolled back — validation failed after ${WORK_RETRIES + 1} attempts: ${errors
              .map((e) => `${e.path} [${e.rule}] ${e.message}`)
              .join("; ")}`,
            committed: false,
          };
        }
        loopInput = { ...loopInput, previousErrors: errors };
      }
      throw new Error("unreachable");
    });
  }

  async function writeInboxStub(content: string, question: string, evidenceRef: string): Promise<string> {
    const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = `Inbox/needs-filing-${stamp}.md`;
    const stub = [
      "---",
      "status: needs-filing",
      `question: ${JSON.stringify(question)}`,
      `evidence: ${JSON.stringify(evidenceRef)}`,
      "---",
      "",
      content.trimEnd(),
      "",
    ].join("\n");
    await mkdir(dirname(join(vaultPath, path)), { recursive: true });
    await writeFile(join(vaultPath, path), stub);
    return path;
  }

  /**
   * The librarian pipeline — docs/M0-SPEC.md § The librarian pipeline.
   * `priority` defaults to interactive (direct callers — MCP, Drive, chat —
   * await the result). Background filing from the tasking loop passes
   * "background" so it can never starve an interactive turn (#96).
   */
  async function store(input: StoreInput, priority: QueuePriority = "interactive"): Promise<StoreResult> {
    assertVault(repo);
    return queue.run(async () => {
      await repo.pull().catch(() => {
        // offline or empty remote — proceed against the local clone
      });
      lastSyncMs = now().getTime();

      const config = await loadBrainConfig(vaultPath);
      const verbatim = input.verbatim ?? /verbatim|exact words/i.test(input.content);

      // 1-2. Normalize + record evidence (append-only).
      const evidence = await appendEvidence(vaultPath, input.content, input.source, verbatim, now());
      const citation = `[[${evidence.date}#^${evidence.anchor}]]`;
      const evidenceRef = `${evidence.logPath}#^${evidence.anchor}`;

      // 3. Classify.
      const snapshot = await scanVault(vaultPath);
      let classification: Classification;
      try {
        reportTokenCost("classify", [
          input.content,
          ...(input.hints ?? []),
          snapshot.pages.map((p) => `${p.path} | ${p.title} | ${p.tags.join(",")} | ${p.summary}`).join("\n"),
          config.tags.join(", "),
        ]);
        classification = await llm.classify({
          content: input.content,
          hints: input.hints ?? [],
          pageIndex: snapshot.pages,
          tagVocabulary: config.tags,
        });
      } catch (err) {
        await repo.discardChanges();
        throw new Error(`classification failed, store rolled back cleanly: ${(err as Error).message}`);
      }

      // 4. Branch on confidence — ask, don't guess.
      if (classification.confidence < config.confidenceThreshold || classification.pages.length === 0) {
        const question =
          classification.question ?? "Where should this memory be filed? I could not classify it confidently.";
        const stubPath = await writeInboxStub(input.content, question, evidenceRef);
        const sha = await repo.commitAndPush(`memory: (inbox) ${classification.summary}`);
        return {
          evidenceRef,
          pagesTouched: [stubPath],
          commitSha: sha,
          githubUrls: [githubUrl(location, evidence.logPath), githubUrl(location, stubPath)].filter(Boolean),
          question,
        };
      }

      // 5-6. Update meaning pages with validate-and-retry; never half-apply.
      const template = await readFile(join(vaultPath, "_templates/Area.md"), "utf8").catch(() => DEFAULT_TEMPLATE);
      const touched: string[] = [];
      try {
        for (const page of classification.pages) {
          const folder = page.path.split("/")[0] ?? "";
          const requiredType = MEANING_FOLDERS[folder];
          if (!requiredType) {
            throw new Error(`classifier proposed a non-meaning path: ${page.path}`);
          }
          const absolute = join(vaultPath, page.path);
          const currentContent = await readFile(absolute, "utf8").catch(() => null);

          // Give the composer valid wikilink targets (no orphans): the folder
          // index first, then a few existing meaning pages.
          const indexPath = `${folder}/${folder} Index.md`;
          const linkHints: string[] = [];
          if (snapshot.files.includes(indexPath)) {
            linkHints.push(`[[${folder}/${folder} Index|${folder}]]`);
          }
          for (const p of snapshot.pages) {
            if (p.path === page.path) continue;
            linkHints.push(`[[${p.path.replace(/\.md$/, "")}|${p.title}]]`);
            if (linkHints.length >= 4) break;
          }

          let lastErrors = undefined as import("../types.js").LintError[] | undefined;
          let composed = false;
          for (let attempt = 0; attempt <= COMPOSE_RETRIES; attempt++) {
            reportTokenCost(
              "compose",
              [
                page.path,
                currentContent ?? template,
                evidence.entry,
                citation,
                config.tags.join(", "),
                input.content,
                ...(lastErrors?.map((e) => `${e.path} [${e.rule}] ${e.message}`) ?? []),
              ],
              undefined,
              attempt === 0 ? "store" : "retry",
            );
            const next = await llm.composePage({
              path: page.path,
              currentContent,
              template,
              evidenceEntry: evidence.entry,
              citation,
              classification,
              tagVocabulary: config.tags,
              today: todayString(now()),
              requiredType,
              linkHints,
              ...(lastErrors ? { previousErrors: lastErrors } : {}),
            });
            await mkdir(dirname(absolute), { recursive: true });
            await writeFile(absolute, next);

            const report = await lintVault(vaultPath, [page.path]);
            const immutability = checkEvidenceImmutability(await repo.pendingChanges());
            const errors = [...report.errors, ...immutability];
            if (errors.length === 0) {
              composed = true;
              break;
            }
            lastErrors = errors;
          }
          if (!composed) {
            throw new Error(
              `page ${page.path} failed validation after ${COMPOSE_RETRIES + 1} attempts: ${lastErrors
                ?.map((e) => e.rule)
                .join(", ")}`,
            );
          }
          touched.push(page.path);
        }
      } catch (err) {
        // Fallback: revert everything, re-record evidence, land as an Inbox question.
        await repo.discardChanges();
        const retried = await appendEvidence(vaultPath, input.content, input.source, verbatim, now());
        const retriedRef = `${retried.logPath}#^${retried.anchor}`;
        const question = `I recorded the evidence but could not file it (${(err as Error).message}). Where should it go?`;
        const stubPath = await writeInboxStub(input.content, question, retriedRef);
        const sha = await repo.commitAndPush(`memory: (inbox) ${classification.summary}`);
        return {
          evidenceRef: retriedRef,
          pagesTouched: [stubPath],
          commitSha: sha,
          githubUrls: [githubUrl(location, retried.logPath), githubUrl(location, stubPath)].filter(Boolean),
          question,
        };
      }

      // 7-8. One commit per store.
      const sha = await repo.commitAndPush(`memory: ${classification.summary}`);
      const result: StoreResult = {
        evidenceRef,
        pagesTouched: touched,
        commitSha: sha,
        githubUrls: [
          githubUrl(location, evidence.logPath),
          ...touched.map((p) => githubUrl(location, p)),
        ].filter(Boolean),
      };
      if (shouldDigestForBacklog(input)) {
        const sourceRefs = [{ path: evidenceRef, githubUrl: githubUrl(location, evidence.logPath) }];
        try {
          const extracted = await llm.extractBacklog({ content: input.content, sourceRefs });
          const candidates = ensureCandidateSources(extracted.candidates, sourceRefs);
          result.backlog = {
            candidates,
            written: [],
            skipped: [{ reason: "proactive digestion is proposal-only; write not requested" }],
            source_refs: sourceRefs,
          };
        } catch (err) {
          result.backlog = {
            candidates: [],
            written: [],
            skipped: [{ reason: `backlog digestion failed: ${(err as Error).message}` }],
            source_refs: sourceRefs,
          };
        }
      }
      return result;
    }, priority);
  }

  async function ask(question: string): Promise<Answer> {
    assertVault(repo);
    await syncForRead();
    const briefing = await vaultBriefing();
    reportTokenCost("ask", [briefing.text, question], briefing);
    const result = await llm.answer(
      { question, vaultBriefing: briefing.text, conversation: [] },
      readTools(),
    );
    return {
      text: result.text,
      sources: result.readPaths.map((path) => ({ path, githubUrl: githubUrl(location, path) })),
    };
  }

  // The model can finish a turn with no closing text — most often when it
  // exhausts its step budget mid-tool-call (generateText then returns ""). An
  // empty reply is silently dropped by the WhatsApp gateway and looks like Zeno
  // ignoring the user, so always produce *something*: the real tool results if
  // any ran, otherwise an honest retry notice. Reconciliation runs first so a
  // fabricated mutation is still corrected before we consider falling back.
  // The legacy "Created issue #N" reconciliation guard is removed while the backlog
  // logic is revamped (Archus owns issues now; the Console just relays peer results,
  // and the guard kept "correcting" true results). Keep only the empty-reply fallback.
  function finalizeReply(rawText: string, actions: TaskingAction[]): string {
    if (rawText.trim()) return rawText;
    const summary = summarizeActionsForReply(actions);
    return summary
      ? `${summary}\n\n(That's what I did — I ran out of room to write a fuller reply.)`
      : "I couldn't compose a reply to that one — mind rephrasing or sending it again?";
  }

  async function chat(
    message: string,
    surface: Surface,
    onDeltaOrOptions?: ((delta: string) => void) | ChatOptions,
    onToolEvent?: (event: ChatToolEvent) => void,
    conversationKey?: string,
  ): Promise<Reply> {
    const chatOptions =
      typeof onDeltaOrOptions === "function"
        ? { onDelta: onDeltaOrOptions, onToolEvent, conversationKey }
        : (onDeltaOrOptions ?? {});
    await syncForRead();
    const cid = conversationId(surface, chatOptions.conversationKey);
    const window = await state.recentWindow(cid);
    await state.appendMessage(cid, "user", message, surface);

    const wantsStore = /\b(remember|store|save|capture|log) (this|that|it)\b/i.test(message);
    let stored: StoreResult | undefined;
    if (wantsStore && repo) {
      stored = await store({ content: message, source: surface });
    }

    const actions: TaskingAction[] = [];
    // Task tools when there's a vault (capture/propose) OR external tasking tools
    // (a backlog agent: GitHub issues without a vault). Plain chat otherwise.
    const taskTools =
      repo || options.taskingTools ? buildTaskTools(surface, (action) => actions.push(action)) : undefined;
    const briefing = await vaultBriefing();
    reportTokenCost("chat", [briefing.text, ...window.map((m) => m.text), message], briefing);

    const result = await llm.answer(
      {
        question: message,
        vaultBriefing: briefing.text,
        conversation: window.map((m) => ({ role: m.role, text: m.text })),
        ...(chatOptions.onDelta ? { onTextDelta: chatOptions.onDelta } : {}),
        ...(chatOptions.onToolEvent ? { onToolEvent: chatOptions.onToolEvent } : {}),
      },
      readTools(),
      taskTools,
      options.driveTools,
      options.peerTools,
    );
    const text = finalizeReply(result.text, actions);
    await state.appendMessage(cid, "assistant", text, surface);

    return {
      text,
      sources: result.readPaths.map((path) => ({ path, githubUrl: githubUrl(location, path) })),
      ...(stored ? { stored } : {}),
    };
  }

  async function handleTasking(input: { text: string; surface: TaskingSurface; conversationKey: string }): Promise<TaskingReply> {
    await syncForRead();
    const cid = conversationId(input.surface, input.conversationKey);
    const window = await state.recentWindow(cid);
    await state.appendMessage(cid, "user", input.text, input.surface);

    const actions: TaskingAction[] = [];
    const briefing = await vaultBriefing();
    reportTokenCost("tasking", [briefing.text, ...window.map((m) => m.text), input.text], briefing);
    const result = await llm.answer(
      {
        question: input.text,
        vaultBriefing: briefing.text,
        conversation: window.map((m) => ({ role: m.role, text: m.text })),
        onPeerAction: (tool, inp, res) => actions.push({ tool, input: inp, result: res }),
      },
      readTools(),
      repo || options.taskingTools ? buildTaskTools(input.surface, (action) => actions.push(action)) : undefined,
      options.driveTools,
      options.peerTools,
    );
    const text = finalizeReply(result.text, actions);
    await state.appendMessage(cid, "assistant", text, input.surface);
    return { text, actions };
  }

  return {
    store,
    ask,
    chat,
    handleTasking,
    work,
    digestBacklog,
    describeImage: (imageData: Uint8Array, mimeType: string, prompt?: string) =>
      llm.describeImage(imageData, mimeType, prompt),
    search: async (query: string): Promise<Hit[]> => {
      assertVault(repo);
      await syncForRead();
      return searchVault(vaultPath, query, location);
    },
    get: async (path: string): Promise<Note> => {
      assertVault(repo);
      await syncForRead();
      return getNote(vaultPath, path, location);
    },
    lint: async (): Promise<LintReport> => {
      assertVault(repo);
      await syncForRead();
      return lintVault(vaultPath);
    },
  };
}
