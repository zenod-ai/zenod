import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type {
  Answer,
  AskOptions,
  BacklogCandidate,
  BacklogDigestInput,
  BacklogDigestResult,
  BacklogSourceRef,
  BrainEngine,
  ChatOptions,
  EnrichEvidenceInput,
  ExternalTaskingTools,
  Hit,
  LintReport,
  MemoryEntry,
  MemoryEntryQuery,
  Note,
  Reply,
  StateStore,
  StoreInput,
  StoreResult,
  Surface,
  TaskingAction,
  TaskingInput,
  TaskingReply,
  TokenCostMeasurement,
  TokenCostOperation,
  WorkInput,
  WorkResult,
} from "../types.js";
import { ContextRefError, EVIDENCE_CONTEXT_REF_PATTERN } from "../types.js";
import { loadBrainConfig } from "../vault/config.js";
import { checkEvidenceImmutability } from "../vault/immutability.js";
import { lintVault } from "../vault/lint.js";
import { scanVault } from "../vault/pages.js";
import { githubUrl, type VaultLocation } from "../vault/github.js";
import { getNote } from "../ops/get.js";
import { readNotePassage, type NoteReadOptions, type NotePassage } from "../ops/passage.js";
import { searchVault } from "../ops/search.js";
import { WriteQueue, type QueuePriority } from "../git/queue.js";
import { assertVaultProviderUrl, type VaultRepository, type VaultRevision, type VaultSourceRef } from "../vault/repository.js";
import type { AnswerInput, BrainLlm, ChatToolEvent, Classification, DriveSourceTools, PeerTools, VaultReadTools, VaultTaskTools } from "../llm/types.js";
import { appendEvidence, getEvidenceEntry, searchEvidenceEntries, todayString } from "./evidence.js";
import { isGithubConnectionRequiredError } from "../connections/github.js";
import { sanitizeGroundedAnswer } from "./answerGrounding.js";
import { listAttachmentFiles, MEANING_FOLDERS, normalizeMarkdownNotePath } from "../vault/files.js";
import { conversationId } from "../conversation.js";
import {
  isAffirmativeApproval,
  normalizeCreateIssueLabels,
  normalizeLabelIssueLabels,
  NOTHING_PENDING_TO_APPROVE_TEXT,
  reconcileTaskingReply,
  summarizeActionsForReply,
} from "../taskingPolicy.js";
import {
  applyReplyGate,
  hasStandingActionClaim,
  type ReplyGateOutcome,
} from "../replyGate.js";
import {
  approvalTokenSnapshot,
  cancelStandingApprovals,
  classifyApprovalIntent,
  hasAnyLiveApprovalToken,
  hydrateApprovalTokens,
} from "../approvalTokens.js";

const LONG_MESSAGE_DIGEST_CHARS = 1_200;
const ZENOD_DIGEST_TOOL = "zenod_digest_message";
const GROUNDED_STANDING_ACTION_RETRY = [
  "Host retry: the previous answer claimed an action was held for approval, but no action-producing tool result exists, so no standing action exists.",
  "Retry the original request once. If a discovered tool can create or hold the requested action safely, call that exact tool once.",
  "Otherwise state plainly that nothing was held. Never claim held, pending, drafted, sent, or changed without a same-turn tool result.",
].join(" ");

function hasStandingActionEvidence(actions: readonly TaskingAction[]): boolean {
  return actions.some((action) =>
    action.mutationAttempt === true || action.verifiedMutationReceipt === true,
  );
}

function typedAnswerContentForConversation(
  actions: readonly TaskingAction[],
  deliveredText: string,
): string | undefined {
  const answers: string[] = [];
  for (const action of actions) {
    if (
      action.peerAction !== true
      || action.mutationAttempt === true
      || action.verifiedMutationReceipt === true
    ) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(action.result);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const envelope = parsed as Record<string, unknown>;
    if (!Array.isArray(envelope.content) || envelope.content.length !== 1) continue;
    const content = envelope.content[0];
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const textContent = content as Record<string, unknown>;
    if (textContent.type !== "text" || textContent.text !== deliveredText) continue;
    const structured = envelope.structuredContent;
    if (!structured || typeof structured !== "object" || Array.isArray(structured)) continue;
    const answer = structured as Record<string, unknown>;
    if (
      answer.type !== "answer_content"
      || typeof answer.text !== "string"
      || !Array.isArray(answer.sources)
    ) continue;
    const sourceLines: string[] = [];
    let validSources = true;
    for (const source of answer.sources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        validSources = false;
        break;
      }
      const value = source as Record<string, unknown>;
      if (
        typeof value.path !== "string"
        || (value.url !== undefined && typeof value.url !== "string")
        || (value.provider !== undefined && value.provider !== "github" && value.provider !== "google_drive")
        || (value.githubUrl !== undefined && typeof value.githubUrl !== "string")
      ) {
        validSources = false;
        break;
      }
      const url = value.url ?? value.githubUrl;
      sourceLines.push(`- ${value.path}${url ? ` (${url})` : ""}`);
    }
    if (!validSources) continue;
    const status = answer.status;
    if (!status || typeof status !== "object" || Array.isArray(status)) continue;
    const readOnlyStatus = status as Record<string, unknown>;
    if (
      readOnlyStatus.type !== "read_only_status"
      || typeof readOnlyStatus.text !== "string"
    ) continue;
    answers.push(sourceLines.length > 0
      ? `${answer.text}\n\nSources:\n${sourceLines.join("\n")}`
      : answer.text);
  }
  return answers.length === 1 ? answers[0] : undefined;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface ZenodDigestIntent {
  type: string;
  text: string;
  confidence?: number;
  suggestedOwner?: string;
  requiresConfirmation?: boolean;
}

interface ZenodDigestPacket {
  receipt?: Record<string, unknown>;
  interpretation?: string;
  intentList?: ZenodDigestIntent[];
}

function directShortCommand(text: string): boolean {
  if (text.length > 420) return false;
  return /\b(run|execute|start|queue|status|read|find|search|list|close|update|label|link|notify|send|post)\b/i.test(text);
}

function shouldDigestBeforeTasking(text: string, peerTools?: PeerTools): boolean {
  if (!peerTools?.[ZENOD_DIGEST_TOOL]) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("ZENOD DIGESTION")) return false;
  if (directShortCommand(trimmed)) return false;
  return trimmed.length >= LONG_MESSAGE_DIGEST_CHARS;
}

function firstJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseZenodDigest(raw: string): ZenodDigestPacket {
  const json = firstJsonObject(raw);
  if (!json) return { interpretation: raw.trim(), intentList: [], receipt: { warnings: ["Zenod returned prose instead of JSON"] } };
  try {
    const parsed = JSON.parse(json) as ZenodDigestPacket;
    return {
      ...(parsed.receipt && typeof parsed.receipt === "object" ? { receipt: parsed.receipt } : {}),
      ...(typeof parsed.interpretation === "string" ? { interpretation: parsed.interpretation } : {}),
      ...(Array.isArray(parsed.intentList) ? { intentList: parsed.intentList } : { intentList: [] }),
    };
  } catch (err) {
    return {
      interpretation: raw.trim(),
      intentList: [],
      receipt: { warnings: [`Zenod digestion JSON parse failed: ${(err as Error).message}`] },
    };
  }
}

function formatZenodDigestRequest(input: {
  text: string;
  surface: TaskingInput["surface"];
  conversationKey: string;
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
}): string {
  const recentContext = input.conversation
    .slice(-6)
    .map((m) => `${m.role}: ${chatSnippet(m.text)}`)
    .join("\n");
  return [
    "Digest this long user message for Console. Return ONLY compact JSON with keys: receipt, interpretation, intentList.",
    "",
    "Rules:",
    "- You are Zenod, the brain/digestion layer. Do not create GitHub issues, queue execution, notify, or decide the journey.",
    "- Keep intentList short and conservative.",
    "- Distinguish reflection/possible future ideas from explicit create/update/run/notify commands.",
    "- Use suggestedOwner values: console, zenod, archus, epaminon, phylax.",
    "",
    "Source:",
    JSON.stringify({ surface: input.surface, conversationKey: input.conversationKey }),
    "",
    recentContext ? `Recent conversation:\n${recentContext}\n` : "",
    "User message/transcript:",
    input.text,
  ].join("\n");
}

function formatDigestedContextNote(rawDigest: string): string {
  const packet = parseZenodDigest(rawDigest);
  const receipt = packet.receipt ? stableJson(packet.receipt) : "{}";
  const intents = (packet.intentList ?? [])
    .slice(0, 8)
    .map((intent, index) => {
      const confidence = typeof intent.confidence === "number" ? ` confidence=${intent.confidence}` : "";
      const owner = intent.suggestedOwner ? ` owner=${intent.suggestedOwner}` : "";
      const confirm = intent.requiresConfirmation === undefined ? "" : ` requiresConfirmation=${intent.requiresConfirmation}`;
      return `${index + 1}. [${intent.type}${confidence}${owner}${confirm}] ${intent.text}`;
    });

  return [
    "ZENOD DIGESTION RECEIVED",
    "",
    "Console must use this as first-pass understanding, then own the journey decision.",
    "Do not expose this packet, internal ledgers, or debug plans to the user.",
    "Do not mutate backlog, execution, or notifications unless an intent clearly requires it and the owning specialist returns evidence.",
    "",
    `Receipt: ${receipt}`,
    `Interpretation: ${packet.interpretation?.trim() || "(no interpretation returned)"}`,
    "Suggested intents:",
    ...(intents.length > 0 ? intents : ["- none"]),
  ].join("\n");
}

export interface EngineOptions {
  /**
   * The vault repo. Optional: when omitted the engine runs "vaultless" — no
   * sync, no vault briefing, no vault read/write tools — for the Console shell
   * (the suite's base minus the vault capability). Vault-only methods (store,
   * work, ask, search, get, lint, digestBacklog) throw a clear error in that
   * mode; chat/handleTasking run with a persona-only briefing.
   */
  repo?: VaultRepository;
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
  /**
   * M-5 — fired when a background captureNote filing actually lands (the commit is
   * real, not just queued). The engine only console.info's this today; the server
   * wires it to the normal notification path so a background filing gets a real
   * completion receipt instead of a silent log line.
   */
  onFilingComplete?: (result: StoreResult) => void;
}

// One retry, not two: attempt 0 composes, attempt 1 re-composes with the lint
// errors fed back (the high-value correction). A third attempt rarely recovers
// what the second didn't and just adds a full compose round-trip per page to the
// worst case — costly on long, multi-page stores. On exhaustion we fall back to
// an Inbox stub, so a hard case is parked for the user, never half-applied.
const COMPOSE_RETRIES = 1;
const CLASSIFY_RETRIES = 1;
export const LONG_MEMORY_SEGMENT_CHARS = 12_000;
const WORK_RETRIES = 2;
const DEFAULT_READ_SYNC_TTL_MS = 60_000;
const MAX_BRIEFING_MEANING_PAGES = 80;
const MAX_BRIEFING_LOG_FILES = 20;
const MAX_BRIEFING_ATTACHMENTS = 40;
const MAX_BRIEFING_SUMMARY_CHARS = 240;
const MAX_ASK_CONTEXT_REFS = 10;
const EVIDENCE_CONTEXT_REF_RE = new RegExp(EVIDENCE_CONTEXT_REF_PATTERN);

function splitOversizeMemoryPart(part: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = part.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const newline = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const boundary = Math.max(sentence >= maxChars / 2 ? sentence + 1 : -1, newline, space);
    const cut = boundary >= maxChars / 2 ? boundary : maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Preserve one raw capture while classifying long voice notes topic-sized piece by piece. */
export function segmentLongMemoryContent(
  content: string,
  maxChars = LONG_MEMORY_SEGMENT_CHARS,
): string[] {
  const normalized = content.trim();
  if (!normalized || normalized.length <= maxChars) return [normalized];
  const parts = normalized
    .split(/\n\s*\n/g)
    .flatMap((part) => splitOversizeMemoryPart(part, maxChars))
    .filter(Boolean);
  const segments: string[] = [];
  let current = "";
  for (const part of parts) {
    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length > maxChars && current) {
      segments.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function verbatimEntityCandidates(content: string): string[] {
  return [...new Set(content.match(/\b[A-Z][A-Za-z0-9'-]{2,}(?:\s+[A-Z][A-Za-z0-9'-]{2,}){0,3}\b/g) ?? [])]
    .slice(0, 20);
}

function mergeSegmentClassifications(classifications: Classification[]): Classification {
  if (classifications.length === 1) return classifications[0]!;
  const pages = new Map<string, Classification["pages"][number]>();
  for (const classification of classifications) {
    for (const page of classification.pages) {
      const key = normalizeMarkdownNotePath(page.path);
      if (!pages.has(key)) pages.set(key, { ...page, path: key });
    }
  }
  const questions = [...new Set(classifications.map((item) => item.question).filter(Boolean))];
  return {
    confidence: Math.min(...classifications.map((item) => item.confidence)),
    summary: classifications.map((item) => item.summary).join("; ").slice(0, 240),
    tags: [...new Set(classifications.flatMap((item) => item.tags))],
    pages: [...pages.values()],
    ...(questions.length ? { question: questions.join(" ") } : {}),
  };
}

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
  // State stores are tenant-local in hosted Ring. This runtime nonce prevents two
  // tenants with the same human conversation key from sharing the in-process cache;
  // durable rows are re-hydrated into the new nonce after a restart.
  const approvalScope = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const scopedApprovalId = (conversationId: string) => `${approvalScope}:${conversationId}`;

  async function prepareApprovalTurn(conversationId: string, message: string): Promise<string> {
    const scoped = scopedApprovalId(conversationId);
    if (state.loadApprovalTokens) hydrateApprovalTokens(scoped, await state.loadApprovalTokens(conversationId));
    if (classifyApprovalIntent(message) === "cancel") cancelStandingApprovals(scoped);
    return scoped;
  }

  async function persistApprovalTurn(conversationId: string, scoped: string): Promise<void> {
    if (state.saveApprovalTokens) await state.saveApprovalTokens(conversationId, approvalTokenSnapshot(scoped));
  }
  // Vaultless mode (Console shell): no repo → vaultPath is empty and every vault
  // touchpoint below guards on `repo`. assertVault() gates the vault-only methods.
  const vaultPath = repo ? repo.path : "";
  // Assertion (not just a throw) so TS narrows `repo` to VaultRepository for the rest of
  // a vault-only method after the guard, keeping `repo.pull()` etc. well-typed.
  function assertVault(value: VaultRepository | undefined): asserts value is VaultRepository {
    if (!value) throw new Error("This agent has no vault configured — vault operations are unavailable.");
  }
  const location = options.location ?? {};
  const now = options.now ?? (() => new Date());
  const queue = new WriteQueue();
  const readSyncTtl = options.readSyncTtlMs ?? DEFAULT_READ_SYNC_TTL_MS;
  let lastSyncMs = Number.NEGATIVE_INFINITY;

  function assertRepositoryRevision(revision: VaultRevision): void {
    assertVault(repo);
    if (!revision.id || revision.provider !== repo.provider) {
      throw new Error(`published vault revision mismatch: expected ${repo.provider}, received ${revision.provider} ${revision.id || "(empty)"}`);
    }
    if (revision.provider === "google_drive") {
      if (revision.githubUrls !== undefined) {
        throw new Error("published Google Drive revision must not contain GitHub URLs");
      }
      if (revision.commitSha && revision.commitSha === revision.id) {
        throw new Error("published Google Drive revision id must remain independent from its Git bundle commit");
      }
    }
    for (const url of revision.urls) assertVaultProviderUrl(revision.provider, url);
  }

  function repositoryUrl(path: string, anchor?: string, revision?: VaultRevision): string {
    assertVault(repo);
    if (repo.provider === "github" && location.repo) {
      return githubUrl(
        revision?.commitSha ? { ...location, branch: revision.commitSha } : location,
        path,
        anchor,
      );
    }
    const url = repo.urlFor(path, anchor) ?? "";
    assertVaultProviderUrl(repo.provider, url);
    return url;
  }

  function repositorySourceRef(path: string, anchor?: string, revision?: VaultRevision): VaultSourceRef {
    assertVault(repo);
    const url = repositoryUrl(path, anchor, revision);
    return {
      path: anchor ? `${path}#${anchor}` : path,
      url,
      provider: repo.provider,
      ...(revision ? { revisionId: revision.id } : {}),
      ...(repo.provider === "github" ? { githubUrl: url } : {}),
    };
  }

  const sourceResolver = (path: string, anchor?: string) => repositorySourceRef(path, anchor);

  function publicationFields(
    revision: VaultRevision,
    refs: Array<{ path: string; anchor?: string }>,
  ): Pick<StoreResult, "revision" | "urls" | "commitSha" | "githubUrls"> {
    assertVault(repo);
    assertRepositoryRevision(revision);
    const urls = refs.map((ref) => repositoryUrl(ref.path, ref.anchor, revision)).filter(Boolean);
    const githubUrls = repo.provider === "github"
      ? refs.map((ref) => repositoryUrl(ref.path)).filter(Boolean)
      : undefined;
    const normalizedRevision: VaultRevision = {
      ...revision,
      urls,
      ...(repo.provider === "github" ? { githubUrls: githubUrls ?? [] } : {}),
    };
    return {
      revision: normalizedRevision,
      urls,
      ...(revision.commitSha ? { commitSha: revision.commitSha } : {}),
      ...(githubUrls ? { githubUrls } : {}),
    };
  }

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
      "Summaries are lossy. read_note returns bounded sections with extent, version, omittedBefore and nextCursor. Use query to locate a literal passage, or follow nextCursor with the same path to read onward. A partial read or unmatched query is not proof of absence. If the turn budget prevents full coverage, explicitly say coverage is partial rather than claiming the information does not exist.",
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
        const hits = await searchVault(vaultPath, query, sourceResolver);
        if (hits.length === 0) return "no results";
        return hits.map((h) => `${h.path} (score ${h.score}) — ${h.snippet}`).join("\n");
      },
      readNote: async (path: string, readOptions?: NoteReadOptions) => {
        const revision = await repo.currentRevision();
        return JSON.stringify(await readNotePassage(vaultPath, path, readOptions,
          (sourcePath, anchor) => repositorySourceRef(sourcePath, anchor, revision)));
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
        const clean = normalizeMarkdownNotePath(guardedPath(path));
        await mkdir(dirname(join(vaultPath, clean)), { recursive: true });
        await writeFile(join(vaultPath, clean), content.endsWith("\n") ? content : `${content}\n`);
        return `wrote ${clean}`;
      },
      moveNote: async (from: string, to: string) => {
        const cleanFrom = normalizeMarkdownNotePath(guardedPath(from));
        const cleanTo = normalizeMarkdownNotePath(guardedPath(to));
        await mkdir(dirname(join(vaultPath, cleanTo)), { recursive: true });
        await rename(join(vaultPath, cleanFrom), join(vaultPath, cleanTo));
        return `moved ${cleanFrom} -> ${cleanTo}`;
      },
      deleteNote: async (path: string) => {
        const clean = normalizeMarkdownNotePath(guardedPath(path));
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
      .map((ref) => `- ${ref.path}${ref.url ? ` — ${ref.url}` : ""}`)
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

  function assertBacklogSourceRef(ref: BacklogSourceRef): void {
    assertVault(repo);
    if (ref.provider === "google_drive") assertVaultProviderUrl(ref.provider, ref.url);
    if (ref.githubUrl !== undefined && (repo.provider !== "github" || ref.provider !== "github")) {
      throw new Error("Google Drive backlog sources must not contain GitHub compatibility URLs");
    }
  }

  async function collectBacklogSource(input: BacklogDigestInput): Promise<{ content: string; sourceRefs: BacklogSourceRef[] }> {
    if (input.rawText?.trim()) {
      const sourceRefs = (input.sourceRefs ?? []).map((source) => "url" in source
        ? source
        : { path: source.path, url: source.githubUrl, provider: "github" as const, githubUrl: source.githubUrl });
      return { content: input.rawText.trim(), sourceRefs };
    }

    if (input.memoryPath?.trim()) {
      const note = await getNote(vaultPath, input.memoryPath.trim(), sourceResolver);
      return {
        content: note.body,
        sourceRefs: [{
          path: note.path,
          url: note.url,
          provider: note.provider,
          ...(note.revisionId ? { revisionId: note.revisionId } : {}),
          ...(note.githubUrl !== undefined ? { githubUrl: note.githubUrl } : {}),
        }],
      };
    }

    if (input.query?.trim()) {
      const hits = (await searchVault(vaultPath, input.query.trim(), sourceResolver)).slice(0, 5);
      const notes = await Promise.all(hits.map((hit) => getNote(vaultPath, hit.path, sourceResolver)));
      return {
        content: notes.map((note) => `# ${note.path}\n${note.body}`).join("\n\n"),
        sourceRefs: notes.map((note) => ({
          path: note.path,
          url: note.url,
          provider: note.provider,
          ...(note.revisionId ? { revisionId: note.revisionId } : {}),
          ...(note.githubUrl !== undefined ? { githubUrl: note.githubUrl } : {}),
        })),
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
      written.push({ ...repositorySourceRef(path), title: candidate.title });
    }
    return written;
  }

  function pinBacklogSource(ref: BacklogSourceRef, revision: VaultRevision): BacklogSourceRef {
    assertVault(repo);
    assertBacklogSourceRef(ref);
    if (ref.provider !== repo.provider) return ref;
    const marker = ref.path.indexOf("#");
    const path = marker < 0 ? ref.path : ref.path.slice(0, marker);
    const anchor = marker < 0 ? undefined : ref.path.slice(marker + 1);
    const pinned = repositorySourceRef(path, anchor, revision);
    return {
      ...pinned,
      ...(repo.provider === "github" && ref.provider === "github" && ref.githubUrl !== undefined
        ? { githubUrl: ref.githubUrl }
        : {}),
    };
  }

  async function digestBacklog(input: BacklogDigestInput): Promise<BacklogDigestResult> {
    assertVault(repo);
    if (input.write) {
      return queue.run(async () => {
        await repo.pull().catch(() => {});
        lastSyncMs = now().getTime();
        const source = await collectBacklogSource(input);
        source.sourceRefs.forEach(assertBacklogSourceRef);
        const extracted = await llm.extractBacklog(source);
        const candidates = ensureCandidateSources(extracted.candidates, source.sourceRefs);
        candidates.flatMap((candidate) => candidate.source_refs).forEach(assertBacklogSourceRef);
        if (candidates.length === 0) {
          return { candidates, written: [], skipped: [{ reason: "no backlog candidates found" }], source_refs: source.sourceRefs };
        }
        const written = await writeBacklogCandidates(candidates);
        const revision = await repo.commitAndPublish(`backlog: propose ${candidates.length} item${candidates.length === 1 ? "" : "s"}`);
        const pinnedWritten = written.map((item) => ({
          ...pinBacklogSource(item, revision),
          title: item.title,
        }));
        const publication = publicationFields(revision, written.map((item) => ({ path: item.path })));
        const sourceRefs = source.sourceRefs.map((ref) => pinBacklogSource(ref, revision));
        const pinnedCandidates = candidates.map((candidate) => ({
          ...candidate,
          source_refs: candidate.source_refs.map((ref) => pinBacklogSource(ref, revision)),
        }));
        return {
          candidates: pinnedCandidates,
          ...publication,
          written: pinnedWritten,
          skipped: [],
          source_refs: sourceRefs,
        };
      });
    }

    await syncForRead();
    const source = await collectBacklogSource(input);
    source.sourceRefs.forEach(assertBacklogSourceRef);
    const extracted = await llm.extractBacklog(source);
    const candidates = ensureCandidateSources(extracted.candidates, source.sourceRefs);
    candidates.flatMap((candidate) => candidate.source_refs).forEach(assertBacklogSourceRef);
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
        ? ["Written:", ...result.written.map((item) => `- ${item.path}${item.url ? ` (${item.url})` : ""}`)]
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
    return JSON.stringify({
      error: {
        code: "github_connection_required",
        message: `Connect GitHub before using ${name}. Memory and local Markdown backlog tools remain available.`,
      },
    });
  }

  function buildTaskTools(surface: Surface, record?: (action: TaskingAction) => void, rawEvidence?: TaskingInput["rawEvidence"]): VaultTaskTools {
    const sameTurnMutations = new Map<string, Promise<string>>();
    const recordAction = (
      tool: string,
      input: Record<string, unknown>,
      result: string,
      mutationAttempt = false,
    ) => {
      record?.({
        tool,
        input,
        result,
        ...(mutationAttempt ? { mutationAttempt: true } : {}),
      });
    };
    // Mutation tools must leave a recorded action whether they succeed OR throw,
    // so the reply can be reconciled against what really happened — a failed
    // create must never be narratable as success. The error is still re-thrown
    // so the LLM tool layer surfaces it to the model as before.
    const runMutation = async (tool: string, input: Record<string, unknown>, run: () => Promise<string>): Promise<string> => {
      const key = `${tool}:${stableJson(input)}`;
      const existing = sameTurnMutations.get(key);
      if (existing) return existing;
      const pending = (async () => {
        try {
          const result = await run();
          recordAction(tool, input, result, true);
          return result;
        } catch (err) {
          sameTurnMutations.delete(key);
          if (isGithubConnectionRequiredError(err)) {
            const result = JSON.stringify({ error: { code: err.code, message: err.message } });
            recordAction(tool, input, result, true);
            return result;
          }
          recordAction(tool, input, `ERROR: ${(err as Error).message}`, true);
          throw err;
        }
      })();
      sameTurnMutations.set(key, pending);
      return pending;
    };
    return {
      githubAvailable: Boolean(options.taskingTools),
      captureNote: async (content: string, hints?: string[]) => {
        if (!repo) {
          return {
            evidenceRef: "(no vault)",
            pagesTouched: [],
            filing: "pending",
            queued: false,
          };
        }
        const storeContent = rawEvidence?.content ?? content;
        const storeHints = [...(hints ?? []), ...(rawEvidence?.hints ?? [])];
        const storeVerbatim = rawEvidence ? true : undefined;
        // The librarian pipeline (classify → compose → digest → durable save) must
        // never sit on the hot reply line: on a slow model it adds minutes
        // (a real WhatsApp turn took ~4 min, ~2:20 of it filing — see
        // docs/SESSION-LOG-FORENSICS.md). Kick it off in the background through
        // the same write queue (so writes still serialize) and return at once;
        // the reply confirms the note is *queued*, not yet durably saved. The filing
        // self-reports to the logs when it lands.
        void store(
          {
            content: storeContent,
            source: surface,
            ...(storeHints.length ? { hints: storeHints } : {}),
            ...(storeVerbatim !== undefined ? { verbatim: storeVerbatim } : {}),
          },
          "background",
        )
          .then((result) => {
            console.info(
              `[librarian] background filing complete: ${result.evidenceRef}` +
                (result.pagesTouched.length ? ` → ${result.pagesTouched.join(", ")}` : " → (inbox)") +
                ` @ ${result.revision?.provider ?? "legacy"}:${result.revision?.id ?? result.commitSha ?? "unknown"}`,
            );
            options.onFilingComplete?.(result);
          })
          .catch((err) => console.error(`[librarian] background filing failed: ${(err as Error).message}`));
        recordAction(
          "capture",
          {
            content: storeContent,
            ...(storeHints.length ? { hints: storeHints } : {}),
            ...(storeVerbatim !== undefined ? { verbatim: storeVerbatim } : {}),
          },
          "Queued: filing this note to the vault in the background (not yet durably saved).",
          true,
        );
        return {
          evidenceRef: "(queued)",
          pagesTouched: [],
          filing: "pending",
          queued: true,
        };
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
          executed.mode === "failed" ? "FAILED (rolled back, nothing saved)" : "DONE",
          executed.text,
          ...(executed.revision ? [`saved revision: ${executed.revision.provider}:${executed.revision.id}`] : []),
          ...(executed.commitSha ? [`commit: ${executed.commitSha}`] : []),
          ...(executed.changedPaths?.length ? [`changed: ${executed.changedPaths.join(", ")}`] : []),
        ].join("\n");
        recordAction("executeVaultTask", { objective, plan }, text, true);
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
        const nonBlank = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);
        const normalized = {
          ...input,
          repo: input.repo || defaultRepo(),
          title: nonBlank(input.title),
          body: nonBlank(input.body),
          comment: nonBlank(input.comment),
          status: nonBlank(input.status),
          stateReason: nonBlank(input.stateReason) as typeof input.stateReason | undefined,
        };
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
      queueExecution: async (input) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("queueExecution", normalized, () =>
          options.taskingTools
            ? options.taskingTools.queueExecution({
                target: normalized.target,
                title: normalized.title,
                context: normalized.context,
                ...(normalized.repo ? { repo: normalized.repo } : {}),
              })
            : Promise.resolve(noExternalTool("queueExecution")),
        );
      },
      approveExecution: async (input) => {
        const normalized = { ...input, repo: input.repo || defaultRepo() };
        return runMutation("approveExecution", normalized, () =>
          options.taskingTools
            ? options.taskingTools.approveExecution({
                executionId: normalized.executionId,
                ...(normalized.finalContent ? { finalContent: normalized.finalContent } : {}),
                ...(normalized.repo ? { repo: normalized.repo } : {}),
              })
            : Promise.resolve(noExternalTool("approveExecution")),
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
   * plan, validated, one durable revision per objective). The model arranges
   * the working tree; this function guarantees what lands: lint + evidence
   * immutability, publication or full rollback. Same contract as store, wider verbs.
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
          const revision = await repo.commitAndPublish(`work: ${summary}`);
          const changedPaths = changes.map((c) => c.path);
          return {
            mode: "executed",
            text: result.text,
            committed: true,
            ...publicationFields(revision, changedPaths.map((path) => ({ path }))),
            changedPaths,
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

  function uncertaintyBlock(
    content: string,
    question: string,
    evidence: Awaited<ReturnType<typeof appendEvidence>>,
    confidence: number,
  ): string {
    const normalizedQuestion = question
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
    const quotedContent = content
      .trimEnd()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return [
      `## Unverified capture — ${evidence.date}  ^uc-${evidence.anchor}`,
      "#filing/uncertain",
      `> [!question] ${normalizedQuestion}`,
      `> Evidence: [[${evidence.date}#^${evidence.anchor}]] · confidence ${confidence.toFixed(2)}`,
      "",
      "> [!quote] Captured content",
      quotedContent,
      "",
    ].join("\n");
  }

  function storePublication(
    revision: VaultRevision,
    evidencePath: string,
    evidenceAnchor: string | undefined,
    pagePaths: string[],
  ): Pick<StoreResult, "revision" | "urls" | "commitSha" | "githubUrls" | "evidenceUrl" | "pageUrls"> {
    const evidenceUrl = repositoryUrl(evidencePath, evidenceAnchor, revision);
    const pageUrls = pagePaths.map((path) => repositoryUrl(path, undefined, revision)).filter(Boolean);
    return {
      ...(evidenceUrl ? { evidenceUrl } : {}),
      pageUrls,
      ...publicationFields(revision, [
        { path: evidencePath, ...(evidenceAnchor ? { anchor: evidenceAnchor } : {}) },
        ...pagePaths.map((path) => ({ path })),
      ]),
    };
  }

  async function evidenceResult(
    entry: { evidenceRef: string; path: string },
    revision: VaultRevision,
    filing: StoreResult["filing"] = "pending",
  ): Promise<StoreResult> {
    return {
      evidenceRef: entry.evidenceRef,
      pagesTouched: [],
      ...storePublication(revision, entry.path, undefined, []),
      filing,
    };
  }

  /**
   * Capture is deliberately boring: one immutable Log append and one durable publication.
   * It performs no classification, composition, or semantic recognition, so a
   * transport can truthfully acknowledge custody before expensive filing.
   */
  async function captureEvidence(input: StoreInput): Promise<StoreResult> {
    assertVault(repo);
    return queue.run(async () => {
      await repo.pull().catch(() => {
        // offline or empty remote — proceed against the local clone
      });
      lastSyncMs = now().getTime();

      if (input.sourceId) {
        const existing = (await searchEvidenceEntries(vaultPath, {
          source: input.source,
          ...(input.contentType ? { contentType: input.contentType } : {}),
          sourceId: input.sourceId,
          limit: 1,
        }, sourceResolver))[0];
        if (existing) return evidenceResult(existing, await repo.currentRevision());
      }

      const evidence = await appendEvidence(
        vaultPath,
        input.content,
        input.source,
        input.verbatim ?? false,
        now(),
        {
          ...(input.contentType ? { contentType: input.contentType } : {}),
          ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        },
      );
      const evidenceRef = `${evidence.logPath}#^${evidence.anchor}`;
      const revision = await repo.commitAndPublish(`memory: capture ${input.contentType ?? "evidence"}`);
      return {
        evidenceRef,
        pagesTouched: [],
        ...storePublication(revision, evidence.logPath, `L${evidence.line}`, []),
        filing: "pending",
      };
    }, "interactive");
  }

  /**
   * Background-only semantic filing for evidence that is already immutable.
   * The typed classifier is a spend gate: only integrate_page may call the
   * full-page composer. Evidence-only captures require no second commit.
   */
  async function enrichEvidence(input: EnrichEvidenceInput): Promise<StoreResult> {
    assertVault(repo);
    return queue.run(async () => {
      await repo.pull().catch(() => {
        // offline or empty remote — proceed against the local clone
      });
      lastSyncMs = now().getTime();
      const evidence = await getEvidenceEntry(vaultPath, input.evidenceRef, sourceResolver);
      const capturedRevision = await repo.currentRevision();
      const config = await loadBrainConfig(vaultPath);
      const snapshot = await scanVault(vaultPath);
      const segments = segmentLongMemoryContent(input.content);
      const entities = verbatimEntityCandidates(input.content);
      const classifications: Classification[] = [];
      try {
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
          const segment = segments[segmentIndex]!;
          let classified: Classification | null = null;
          let lastError: unknown;
          for (let attempt = 0; attempt <= CLASSIFY_RETRIES; attempt += 1) {
            const hints = [
              ...(input.hints ?? []),
              "This evidence is already durably captured. Spend full-page composition only when semantic integration is explicitly justified.",
              ...(segments.length > 1
                ? [`Long capture segment ${segmentIndex + 1}/${segments.length}; identify every subject in this segment.`]
                : []),
              ...(entities.length > 0
                ? [`Preserve these source spellings verbatim when uncertain: ${entities.join(", ")}`]
                : []),
            ];
            reportTokenCost("classify", [
              segment,
              ...hints,
              snapshot.pages.map((page) => `${page.path} | ${page.title} | ${page.tags.join(",")} | ${page.summary}`).join("\n"),
              config.tags.join(", "),
            ], undefined, attempt === 0 ? "enrichment-gate" : "retry");
            try {
              classified = await llm.classify({
                content: segment,
                hints,
                pageIndex: snapshot.pages,
                tagVocabulary: config.tags,
              });
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!classified) throw lastError ?? new Error("classification returned no result");
          classifications.push(classified);
        }
      } catch (error) {
        console.warn(`[librarian] enrichment gate unavailable for ${input.evidenceRef}: ${(error as Error).message}`);
        return evidenceResult(evidence, capturedRevision);
      }

      const classification = mergeSegmentClassifications(classifications);
      const disposition = classifications.some((item) => item.disposition === "integrate_page")
        ? "integrate_page"
        : classifications.some((item) => item.disposition === "append_compact_note")
          ? "append_compact_note"
          : classifications.some((item) => item.disposition === "needs_clarification")
            ? "needs_clarification"
            : "evidence_only";
      classification.pages = classification.pages.map((page) => ({
        ...page,
        path: normalizeMarkdownNotePath(page.path),
      }));

      if (disposition === "evidence_only" || disposition === "needs_clarification" || classification.pages.length === 0) {
        return evidenceResult(evidence, capturedRevision, disposition === "evidence_only" ? "filed" : "pending");
      }

      const citationDate = evidence.path.slice("Log/".length, -".md".length);
      const citation = `[[${citationDate}#^${evidence.anchor}]]`;
      const touched: string[] = [];
      try {
        if (disposition === "append_compact_note") {
          const page = classification.pages.find((candidate) => candidate.action === "update");
          if (!page) return evidenceResult(evidence, capturedRevision, "filed");
          const absolute = join(vaultPath, page.path);
          const current = await readFile(absolute, "utf8");
          const separator = current.endsWith("\n") ? "\n" : "\n\n";
          const compactSummary = classification.summary
            .split("\n")
            .map((part) => part.trim())
            .filter(Boolean)
            .join(" ");
          await writeFile(
            absolute,
            `${current}${separator}## Captured update — ${todayString(now())}\n\n- ${compactSummary} (${citation})\n`,
          );
          touched.push(page.path);
        } else {
          const template = await readFile(join(vaultPath, "_templates/Area.md"), "utf8").catch(() => DEFAULT_TEMPLATE);
          for (const page of classification.pages) {
            const folder = page.path.split("/")[0] ?? "";
            const requiredType = MEANING_FOLDERS[folder];
            if (!requiredType) throw new Error(`classifier proposed a non-meaning path: ${page.path}`);
            const absolute = join(vaultPath, page.path);
            const currentContent = await readFile(absolute, "utf8").catch(() => null);
            const linkHints: string[] = [];
            const indexPath = `${folder}/${folder} Index.md`;
            if (snapshot.files.includes(indexPath)) linkHints.push(`[[${folder}/${folder} Index|${folder}]]`);
            for (const candidate of snapshot.pages) {
              if (candidate.path === page.path) continue;
              linkHints.push(`[[${candidate.path.replace(/\.md$/, "")}|${candidate.title}]]`);
              if (linkHints.length >= 4) break;
            }
            let lastErrors: import("../types.js").LintError[] | undefined;
            let composed = false;
            for (let attempt = 0; attempt <= COMPOSE_RETRIES; attempt += 1) {
              reportTokenCost("compose", [
                page.path,
                currentContent ?? template,
                evidence.content,
                citation,
                config.tags.join(", "),
                ...(lastErrors?.map((entry) => `${entry.path} [${entry.rule}] ${entry.message}`) ?? []),
              ], undefined, attempt === 0 ? "background-enrichment" : "retry");
              const next = await llm.composePage({
                path: page.path,
                currentContent,
                template,
                evidenceEntry: evidence.content,
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
              const errors = [...report.errors, ...checkEvidenceImmutability(await repo.pendingChanges())];
              if (errors.length === 0) {
                composed = true;
                break;
              }
              lastErrors = errors;
            }
            if (!composed) throw new Error(`page ${page.path} failed validation after ${COMPOSE_RETRIES + 1} attempts`);
            touched.push(page.path);
          }
        }

        const report = await lintVault(vaultPath, touched);
        const errors = [...report.errors, ...checkEvidenceImmutability(await repo.pendingChanges())];
        if (errors.length > 0) throw new Error(errors.map((entry) => `${entry.path} [${entry.rule}] ${entry.message}`).join("; "));
        const revision = await repo.commitAndPublish(`memory: enrich ${classification.summary}`);
        return {
          evidenceRef: input.evidenceRef,
          pagesTouched: touched,
          ...storePublication(revision, evidence.path, undefined, touched),
          filing: "filed",
        };
      } catch (error) {
        await repo.discardChanges();
        console.warn(`[librarian] background enrichment pending for ${input.evidenceRef}: ${(error as Error).message}`);
        return evidenceResult(evidence, capturedRevision);
      }
    }, "background");
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
      const stored = await (async (): Promise<StoreResult> => {
      await repo.pull().catch(() => {
        // offline or empty remote — proceed against the local clone
      });
      lastSyncMs = now().getTime();

      const config = await loadBrainConfig(vaultPath);
      const verbatim = input.verbatim ?? /verbatim|exact words/i.test(input.content);

      // 1-2. Normalize + record evidence (append-only).
      const evidenceMetadata = {
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      };
      const evidence = await appendEvidence(vaultPath, input.content, input.source, verbatim, now(), evidenceMetadata);
      const citation = `[[${evidence.date}#^${evidence.anchor}]]`;
      const evidenceRef = `${evidence.logPath}#^${evidence.anchor}`;

      // 3. Classify. Long voice notes keep one immutable evidence entry but
      // are classified in bounded topic-sized segments so later subjects are
      // not silently dropped from a large prompt.
      const snapshot = await scanVault(vaultPath);
      let classification: Classification;
      try {
        const segments = segmentLongMemoryContent(input.content);
        const entities = verbatimEntityCandidates(input.content);
        const classifications: Classification[] = [];
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
          const segment = segments[segmentIndex]!;
          let classified: Classification | null = null;
          let lastError: unknown;
          for (let attempt = 0; attempt <= CLASSIFY_RETRIES; attempt += 1) {
            const hints = [
              ...(input.hints ?? []),
              ...(segments.length > 1
                ? [`Long capture segment ${segmentIndex + 1}/${segments.length}; identify every subject in this segment.`]
                : []),
              ...(entities.length > 0
                ? [`Preserve these source spellings verbatim when uncertain: ${entities.join(", ")}`]
                : []),
            ];
            reportTokenCost("classify", [
              segment,
              ...hints,
              snapshot.pages.map((p) => `${p.path} | ${p.title} | ${p.tags.join(",")} | ${p.summary}`).join("\n"),
              config.tags.join(", "),
            ], undefined, attempt === 0 ? "store" : "retry");
            try {
              classified = await llm.classify({
                content: segment,
                hints,
                pageIndex: snapshot.pages,
                tagVocabulary: config.tags,
              });
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!classified) throw lastError ?? new Error("classification returned no result");
          classifications.push(classified);
        }
        classification = mergeSegmentClassifications(classifications);
      } catch {
        // Preserve the raw capture even when the classifier produces empty or
        // unparsable output twice. This is a successful save with filing
        // pending, not data loss or a false transport failure.
        await repo.discardChanges();
        const retried = await appendEvidence(vaultPath, input.content, input.source, verbatim, now(), evidenceMetadata);
        const retriedRef = `${retried.logPath}#^${retried.anchor}`;
        // Provider/schema prose can contain prompt fragments, credentials, or
        // internal transport details. The durable usage ledger owns bounded
        // diagnostic codes; the user's vault receives only this stable reason.
        const question = `Saved, but automatic filing is pending (classification_unavailable) after ${CLASSIFY_RETRIES + 1} attempts.`;
        const stubPath = await writeInboxStub(input.content, question, retriedRef);
        const revision = await repo.commitAndPublish("memory: (inbox) classification pending");
        return {
          evidenceRef: retriedRef,
          pagesTouched: [stubPath],
          ...storePublication(revision, retried.logPath, `L${retried.line}`, [stubPath]),
          filing: "inbox",
        };
      }
      classification = {
        ...classification,
        pages: classification.pages.map((page) => ({ ...page, path: normalizeMarkdownNotePath(page.path) })),
      };

      // 4. With no candidate, preserve the evidence and question in an Inbox stub.
      if (classification.pages.length === 0) {
        const question =
          classification.question ?? "Where should this memory be filed? I could not classify it confidently.";
        const stubPath = await writeInboxStub(input.content, question, evidenceRef);
        const revision = await repo.commitAndPublish(`memory: (inbox) ${classification.summary}`);
        return {
          evidenceRef,
          pagesTouched: [stubPath],
          ...storePublication(revision, evidence.logPath, `L${evidence.line}`, [stubPath]),
          filing: "inbox",
        };
      }

      // Below threshold, file to the top candidate with a deterministic marker.
      if (classification.confidence < config.confidenceThreshold) {
        const page = classification.pages[0]!;
        try {
          const folder = page.path.split("/")[0] ?? "";
          if (!MEANING_FOLDERS[folder]) {
            throw new Error(`classifier proposed a non-meaning path: ${page.path}`);
          }
          const absolute = join(vaultPath, page.path);
          const currentContent = await readFile(absolute, "utf8");
          const question =
            classification.question ?? "Where should this memory be filed? I could not classify it confidently.";
          const block = uncertaintyBlock(input.content, question, evidence, classification.confidence);
          const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
          await writeFile(absolute, `${currentContent}${separator}${block}`);

          const report = await lintVault(vaultPath, [page.path]);
          const errors = [...report.errors, ...checkEvidenceImmutability(await repo.pendingChanges())];
          if (errors.length > 0) {
            throw new Error(
              `uncertainty block failed validation: ${errors
                .map((error) => `${error.path} [${error.rule}] ${error.message}`)
                .join("; ")}`,
            );
          }

          const revision = await repo.commitAndPublish(`memory: (uncertain) ${classification.summary}`);
          return {
            evidenceRef,
            pagesTouched: [page.path],
            ...storePublication(revision, evidence.logPath, `L${evidence.line}`, [page.path]),
            filing: "uncertain",
          };
        } catch (err) {
          await repo.discardChanges();
          const retried = await appendEvidence(vaultPath, input.content, input.source, verbatim, now(), evidenceMetadata);
          const retriedRef = `${retried.logPath}#^${retried.anchor}`;
          const question = `I recorded the evidence but could not file it (${(err as Error).message}). Where should it go?`;
          const stubPath = await writeInboxStub(input.content, question, retriedRef);
          const revision = await repo.commitAndPublish(`memory: (inbox) ${classification.summary}`);
          return {
            evidenceRef: retriedRef,
            pagesTouched: [stubPath],
            ...storePublication(revision, retried.logPath, `L${retried.line}`, [stubPath]),
            filing: "inbox",
          };
        }
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
        const retried = await appendEvidence(vaultPath, input.content, input.source, verbatim, now(), evidenceMetadata);
        const retriedRef = `${retried.logPath}#^${retried.anchor}`;
        const question = `I recorded the evidence but could not file it (${(err as Error).message}). Where should it go?`;
        const stubPath = await writeInboxStub(input.content, question, retriedRef);
        const revision = await repo.commitAndPublish(`memory: (inbox) ${classification.summary}`);
        return {
          evidenceRef: retriedRef,
          pagesTouched: [stubPath],
          ...storePublication(revision, retried.logPath, `L${retried.line}`, [stubPath]),
          filing: "inbox",
        };
      }

      // 7-8. One durable revision per store.
      const revision = await repo.commitAndPublish(`memory: ${classification.summary}`);
      const result: StoreResult = {
        evidenceRef,
        pagesTouched: touched,
        ...storePublication(revision, evidence.logPath, `L${evidence.line}`, touched),
        filing: "filed",
      };
      if (shouldDigestForBacklog(input)) {
        const sourceRefs = [repositorySourceRef(evidence.logPath, `^${evidence.anchor}`, revision)];
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
      })();
      return stored;
    }, priority);
  }

  async function ask(question: string, askOptions: AskOptions = {}): Promise<Answer> {
    assertVault(repo);
    await syncForRead();
    const briefing = await vaultBriefing();
    const contextRefs = [...new Set(askOptions.contextRefs ?? [])];
    if (contextRefs.length > MAX_ASK_CONTEXT_REFS) {
      throw new ContextRefError(`At most ${MAX_ASK_CONTEXT_REFS} evidence context refs are allowed.`);
    }
    const pinnedSpans: Array<{ path: string; text: string }> = [];
    const pinnedSources: Answer["sources"] = [];
    for (const contextRef of contextRefs) {
      const match = EVIDENCE_CONTEXT_REF_RE.exec(contextRef);
      if (!match) throw new ContextRefError(`Invalid evidence context ref: ${contextRef}`);
      const [path, anchor] = contextRef.split("#^") as [string, string];
      let note: Note;
      try {
        note = await getNote(vaultPath, path, sourceResolver);
      } catch {
        throw new ContextRefError(`Evidence context is unavailable in this tenant's vault: ${contextRef}`);
      }
      const heading = new RegExp(`^## .*?\\s+\\^${anchor}\\s*$`, "m");
      const start = note.body.search(heading);
      if (start < 0) {
        throw new ContextRefError(`Evidence context is unavailable in this tenant's vault: ${contextRef}`);
      }
      const following = note.body.slice(start + 1).search(/^## /m);
      const end = following < 0 ? note.body.length : start + 1 + following;
      const text = note.body.slice(start, end).trim();
      pinnedSpans.push({ path, text });
      pinnedSources.push(repositorySourceRef(path, `^${anchor}`));
    }
    const pinnedBriefing = pinnedSpans.length > 0
      ? [
          "PINNED EVIDENCE CONTEXT — answer from these exact tenant-local evidence blocks first. Cite their refs; use broader vault research only when needed.",
          ...pinnedSpans.map((span, index) => `[${contextRefs[index]}]\n${span.text}`),
        ].join("\n\n")
      : "";
    // A resolved contextRef is already the host-verified read result for this ask.
    // Do not append the broad vault briefing: its ordinary "search/read first"
    // contract makes the model ignore the exact pinned block, search for vague
    // pronouns such as "that note", and then falsely report the evidence absent.
    // Read tools remain available if the pinned block itself points elsewhere.
    const scopedBriefingText = pinnedBriefing || briefing.text;
    const scopedBriefing: Briefing = {
      ...briefing,
      text: scopedBriefingText,
      chars: scopedBriefingText.length,
      estimatedTokens: estimateTokens(scopedBriefingText),
    };
    reportTokenCost("ask", [scopedBriefing.text, question], scopedBriefing);
    const tools = readTools();
    const readSpans = new Map<string, string>();
    const readPassages: NotePassage[] = [];
    const passageSources = new Map<string, VaultSourceRef>();
    const groundedTools: VaultReadTools = {
      ...tools,
      ...(tools.readNote
        ? {
            readNote: async (path: string, readOptions?: NoteReadOptions) => {
              const normalizedPath = normalizeMarkdownNotePath(path.split("#")[0]!);
              const pinnedForPath = pinnedSpans.filter(
                (span) => normalizeMarkdownNotePath(span.path) === normalizedPath,
              );
              if (pinnedForPath.length > 0) {
                const text = pinnedForPath.map((span) => span.text).join("\n\n");
                readSpans.set(normalizedPath, text);
                return text;
              }
              const text = await tools.readNote!(path, readOptions);
              const passage = JSON.parse(text) as NotePassage;
              readPassages.push(passage);
              passageSources.set(passage.identity, { ...passage.source, path: passage.identity.includes("#^") ? passage.identity : passage.source.path });
              return text;
            },
          }
        : {}),
    };
    const result = await llm.answer(
      {
        question,
        vaultBriefing: scopedBriefing.text,
        conversation: [],
        ...(pinnedBriefing
          ? {
              hostInstruction:
                "The host already resolved and read the exact tenant-local contextRefs shown in PINNED EVIDENCE CONTEXT. Treat those blocks as the primary read result and answer directly from the pinned evidence. Search or read broader vault material only if the pinned evidence explicitly leaves the question unresolved.",
            }
          : {}),
      },
      groundedTools,
    );
    const sources = [
      ...pinnedSources,
      ...passageSources.values(),
      ...result.readPaths.filter((path) => ![...passageSources.values()].some((source) => source.path.split("#")[0] === normalizeMarkdownNotePath(path.split("#")[0]!))).map((path) => repositorySourceRef(path)),
    ].filter((source, index, all) => all.findIndex((candidate) => candidate.path === source.path) === index);
    return {
      text: sanitizeGroundedAnswer({
        question,
        text: result.text,
        readSpans: [
          ...[...readSpans].map(([path, text]) => ({ path, text })),
          ...readPassages.map((passage) => ({ path: passage.source.path, text: passage.body,
            ...(passage.identity.includes("#^") ? { verifiedAnchor: passage.identity.split("#^")[1]! } : {}),
          })),
        ],
        pinnedSpans,
      }),
      sources,
    };
  }

  // Iteration-6 — the reply gate. On an ACTION turn (this turn invoked a side-effect
  // tool — a send, an issue write, an execution dispatch/approval, or a resolved standing
  // draft approval) the delivered text is EXCLUSIVELY the concatenation of those tools'
  // own receipt text, discarding the model's free text for that turn outright. This is a
  // hard runtime interception, not prose policing: earlier iterations reconciled/corrected
  // the model's claims after the fact (reconcileTaskingReply below) and told the persona to
  // "relay verbatim", but nothing structurally stopped the model from writing something
  // else — a static string scan can't constrain runtime generation. See replyGate.ts.
  //
  // Non-action turns are untouched: the model can finish a turn with no closing text —
  // most often when it exhausts its step budget mid-tool-call (generateText then returns
  // ""). An empty reply is silently dropped by the WhatsApp gateway and looks like Zeno
  // ignoring the user, so always produce *something*: the real tool results if any ran,
  // otherwise an honest retry notice. Then reconcile the drafted reply against the tools
  // that actually ran this turn (reconcileTaskingReply is grounding-aware — it only
  // corrects fabricated mutations, leaving genuine results and read-only summaries
  // untouched). Without this the model could narrate a successful create that 404'd —
  // e.g. "All five tickets placed in zenod/zenod #1..#5" when the repo doesn't resolve.
  function finalizeReply(
    rawText: string,
    actions: TaskingAction[],
    userMessage: string,
    cid: string,
  ): ReplyGateOutcome {
    const gate = applyReplyGate(rawText, actions, (event) => {
      console.warn(
        `[reply-gate] intercepted final reply (${event.tools.join(", ") || "no tools"}) — discarded unsupported model text or preserved MCP evidence. discarded=${JSON.stringify(event.discardedText)}`,
      );
    });
    if (gate.isActionTurn) return gate;

    // P-1 — a bare affirmative ("approved", "yes") that resolved NOTHING this turn (no
    // tool ran at all, so the reply gate above never engaged) must never fall through to
    // the model's own free-form prose ("Understood. What would you like to do next?").
    // Approval is state, not vocabulary (approvalTokens.ts): with no tool invoked and no
    // live standing-draft token for this conversation, the only honest reply is the same
    // deterministic zero-state the token guard itself renders for a resolved bare
    // affirmative.
    if (actions.length === 0 && isAffirmativeApproval(userMessage)) {
      const text = hasAnyLiveApprovalToken(cid)
        ? "Nothing was sent; the pending action was not executed."
        : NOTHING_PENDING_TO_APPROVE_TEXT;
      return {
        isActionTurn: false,
        kind: "failure",
        text,
        intercepted: text.trim() !== rawText.trim(),
      };
    }

    const drafted = gate.text.trim()
      ? gate.text
      : summarizeActionsForReply(actions)
        ? `${summarizeActionsForReply(actions)}\n\n(That's what I did — I ran out of room to write a fuller reply.)`
        : "I couldn't compose a reply to that one — mind rephrasing or sending it again?";
    const text = reconcileTaskingReply(drafted, actions);
    return {
      ...gate,
      text,
      ...(text.trim() !== gate.text.trim()
        ? { kind: "failure" as const, intercepted: true }
        : {}),
    };
  }

  async function chat(
    message: string,
    surface: Surface,
    onDeltaOrOptions?: ((delta: string) => void) | ChatOptions,
    onToolEvent?: (event: ChatToolEvent) => void,
    conversationKey?: string,
  ): Promise<Reply> {
    const chatOptions: ChatOptions =
      typeof onDeltaOrOptions === "function"
        ? {
            onDelta: onDeltaOrOptions,
            ...(onToolEvent ? { onToolEvent } : {}),
            ...(conversationKey ? { conversationKey } : {}),
          }
        : (onDeltaOrOptions ?? {});
    await syncForRead();
    const cid = conversationId(surface, chatOptions.conversationKey);
    const approvalCid = await prepareApprovalTurn(cid, message);
    const window = await state.recentWindow(cid);
    const captureContext = await state.recentCaptureTickets?.(cid);
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
    const question = chatOptions.contextNote
      ? `${chatOptions.contextNote}\n\nOriginal user message:\n${message}`
      : message;
    reportTokenCost("chat", [briefing.text, ...window.map((m) => m.text), question], briefing);

    // D15: no model delta can cross the chat boundary before the same-turn actions
    // have been classified and the final reply gate has selected one outcome. Natural
    // read-only chunks are replayed after that proof; action turns emit one gated block.
    const pendingDeltas: string[] = [];
    const answerInput: AnswerInput = {
      question,
      conversationId: approvalCid,
      vaultBriefing: briefing.text,
      conversation: window.map((m) => ({ role: m.role, text: m.text })),
      ...(captureContext?.length ? { captureContext } : {}),
      ...(chatOptions.onDelta ? { onTextDelta: (delta: string) => pendingDeltas.push(delta) } : {}),
      ...(chatOptions.onToolEvent ? { onToolEvent: chatOptions.onToolEvent } : {}),
      onPeerAction: (tool, inp, res, metadata) => actions.push({
        tool,
        input: inp,
        result: res,
        ...(metadata?.peerAction ? { peerAction: true } : {}),
        ...(metadata?.mutationAttempt ? { mutationAttempt: true } : {}),
        ...(metadata?.verifiedMutationReceipt ? { verifiedMutationReceipt: true } : {}),
        ...(metadata?.verifiedReceiptText ? { verifiedReceiptText: metadata.verifiedReceiptText } : {}),
      }),
      onReadAction: (tool, inp, res) => actions.push({ tool, input: inp, result: res }),
    };
    const readToolSet = readTools();
    let result = await llm.answer(
      answerInput,
      readToolSet,
      taskTools,
      options.driveTools,
      options.peerTools,
    );
    if (!hasStandingActionEvidence(actions) && options.peerTools && hasStandingActionClaim(result.text)) {
      result = await llm.answer(
        { ...answerInput, hostInstruction: GROUNDED_STANDING_ACTION_RETRY, onTextDelta: () => {} },
        readToolSet,
        taskTools,
        options.driveTools,
        options.peerTools,
      );
    }
    const answerContent = { type: "answer_content" as const, text: result.text };
    const readOnlyStatus = {
      type: "read_only_status" as const,
      text: "Read-only answer — no action was performed.",
    };
    const outcome = captureContext?.length && actions.length === 0
      ? {
          isActionTurn: false,
          kind: "answer" as const,
          text: `${answerContent.text}\n\n${readOnlyStatus.text}`,
          intercepted: true,
        }
      : finalizeReply(result.text, actions, message, approvalCid);
    const text = outcome.text;
    if (chatOptions.onDelta) {
      const naturalUnchanged =
        (outcome.kind === "answer" || outcome.kind === "clarification") &&
        !outcome.intercepted &&
        pendingDeltas.join("") === text;
      if (naturalUnchanged) {
        for (const delta of pendingDeltas) chatOptions.onDelta(delta);
      } else if (text) {
        chatOptions.onDelta(text);
      }
    }
    await persistApprovalTurn(cid, approvalCid);
    const conversationText = captureContext?.length && actions.length === 0
      ? answerContent.text
      : typedAnswerContentForConversation(actions, text) ?? text;
    await state.appendMessage(cid, "assistant", conversationText, surface);

    return {
      text,
      sources: result.readPaths.map((path) => repositorySourceRef(path)),
      ...(stored ? { stored } : {}),
    };
  }

  async function handleTasking(input: TaskingInput): Promise<TaskingReply> {
    await syncForRead();
    const cid = conversationId(input.surface, input.conversationKey);
    const approvalCid = await prepareApprovalTurn(cid, input.text);
    const window = await state.recentWindow(cid);
    const captureContext = await state.recentCaptureTickets?.(cid);
    await state.appendMessage(cid, "user", input.text, input.surface);

    const actions: TaskingAction[] = [];
    let contextNote = input.contextNote;
    if (shouldDigestBeforeTasking(input.text, options.peerTools)) {
      const digestInput = {
        source: `${input.surface}:${input.conversationKey}`,
        text: input.text,
      };
      const rawDigest = await options.peerTools![ZENOD_DIGEST_TOOL]!.run(
        formatZenodDigestRequest({
          text: input.text,
          surface: input.surface,
          conversationKey: input.conversationKey,
          conversation: window.map((m) => ({ role: m.role, text: m.text })),
        }),
      );
      actions.push({ tool: ZENOD_DIGEST_TOOL, input: digestInput, result: rawDigest });
      contextNote = [contextNote, formatDigestedContextNote(rawDigest)].filter(Boolean).join("\n\n");
    }

    const briefing = await vaultBriefing();
    const question = contextNote ? `${contextNote}\n\nOriginal user message:\n${input.text}` : input.text;
    reportTokenCost("tasking", [briefing.text, ...window.map((m) => m.text), question], briefing);
    const answerInput: AnswerInput = {
      question,
      conversationId: approvalCid,
      vaultBriefing: briefing.text,
      conversation: window.map((m) => ({ role: m.role, text: m.text })),
      ...(captureContext?.length ? { captureContext } : {}),
      onPeerAction: (tool, inp, res, metadata) => actions.push({
        tool,
        input: inp,
        result: res,
        ...(metadata?.peerAction ? { peerAction: true } : {}),
        ...(metadata?.mutationAttempt ? { mutationAttempt: true } : {}),
        ...(metadata?.verifiedMutationReceipt ? { verifiedMutationReceipt: true } : {}),
        ...(metadata?.verifiedReceiptText ? { verifiedReceiptText: metadata.verifiedReceiptText } : {}),
      }),
      onReadAction: (tool, inp, res) => actions.push({ tool, input: inp, result: res }),
    };
    const readToolSet = readTools();
    const answerTaskTools = repo || options.taskingTools
      ? buildTaskTools(input.surface, (action) => actions.push(action), input.rawEvidence)
      : undefined;
    let result = await llm.answer(
      answerInput,
      readToolSet,
      answerTaskTools,
      options.driveTools,
      options.peerTools,
    );
    if (!hasStandingActionEvidence(actions) && options.peerTools && hasStandingActionClaim(result.text)) {
      result = await llm.answer(
        { ...answerInput, hostInstruction: GROUNDED_STANDING_ACTION_RETRY },
        readToolSet,
        answerTaskTools,
        options.driveTools,
        options.peerTools,
      );
    }
    const answerContent = { type: "answer_content" as const, text: result.text };
    const readOnlyStatus = {
      type: "read_only_status" as const,
      text: "Read-only answer — no action was performed.",
    };
    const text = captureContext?.length && actions.length === 0
      ? `${answerContent.text}\n\n${readOnlyStatus.text}`
      : finalizeReply(result.text, actions, input.text, approvalCid).text;
    await persistApprovalTurn(cid, approvalCid);
    const conversationText = captureContext?.length && actions.length === 0
      ? answerContent.text
      : typedAnswerContentForConversation(actions, text) ?? text;
    await state.appendMessage(cid, "assistant", conversationText, input.surface);
    return { text, actions };
  }

  return {
    store,
    captureEvidence,
    enrichEvidence,
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
      return searchVault(vaultPath, query, sourceResolver);
    },
    searchEntries: async (query: MemoryEntryQuery = {}): Promise<MemoryEntry[]> => {
      assertVault(repo);
      await syncForRead();
      return searchEvidenceEntries(vaultPath, query, sourceResolver);
    },
    getEntry: async (evidenceRef: string): Promise<MemoryEntry> => {
      assertVault(repo);
      await syncForRead();
      return getEvidenceEntry(vaultPath, evidenceRef, sourceResolver);
    },
    get: async (path: string): Promise<Note> => {
      assertVault(repo);
      await syncForRead();
      return getNote(vaultPath, path, sourceResolver);
    },
    lint: async (): Promise<LintReport> => {
      assertVault(repo);
      await syncForRead();
      return lintVault(vaultPath);
    },
  };
}
