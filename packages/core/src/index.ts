export const VERSION = "0.0.1";

export type {
  Answer,
  BacklogCandidate,
  BacklogCandidateType,
  BacklogDifficulty,
  BacklogDigestInput,
  BacklogDigestResult,
  BacklogOwner,
  BacklogPriority,
  BacklogSourceRef,
  BacklogStatus,
  AttachmentInput,
  BrainEngine,
  ChatTestAuditInput,
  ChatTestAuditRecord,
  ChatTestStatus,
  ChatOptions,
  ConversationMessage,
  ExternalTaskingTools,
  Hit,
  LintError,
  LintReport,
  Note,
  Reply,
  SourceRef,
  StateStore,
  StoreInput,
  StoreResult,
  Surface,
  TaskingAction,
  TaskingInput,
  TaskingReply,
  TaskingSurface,
  TokenCostMeasurement,
  TokenCostOperation,
  WorkInput,
  WorkResult,
} from "./types.js";

export { loadBrainConfig, ConfigError, CONFIG_PATH, type BrainConfig } from "./vault/config.js";
export { parseNote, serializeNote, type ParsedNote } from "./vault/frontmatter.js";
export { listMarkdownFiles, tierOf, basenameOf, isIndexFile, MEANING_FOLDERS, type Tier, type MeaningType } from "./vault/files.js";
export { scanVault, extractPageLinks, extractCitations, type PageIndexEntry, type VaultSnapshot } from "./vault/pages.js";
export { lintVault } from "./vault/lint.js";
export { ensureSchemaV1 } from "./vault/migrate.js";
export { cleanSlateVault, type CleanSlateOptions, type CleanSlateResult } from "./vault/cleanSlate.js";
export { githubUrl, type VaultLocation } from "./vault/github.js";
export { searchVault } from "./ops/search.js";
export { getNote, NoteNotFoundError } from "./ops/get.js";
export { checkEvidenceImmutability, type FileChange } from "./vault/immutability.js";
export { WriteQueue } from "./git/queue.js";
export { VaultRepo, type VaultRepoOptions } from "./git/vaultRepo.js";
export {
  selectBacklog,
  orderBacklogItems,
  type BacklogItem,
  type BacklogPriorityRanker,
  type SelectBacklogResult,
} from "./backlog.js";
export { createEngine, conversationId, type EngineOptions } from "./engine/engine.js";
export { appendEvidence, todayString, type EvidenceEntry } from "./engine/evidence.js";
export {
  OWNER_AGENT,
  STATUS_PROPOSED,
  STATUS_QUEUED,
  STATUS_NEEDS_REVIEW,
  STATUS_APPROVED_MERGE,
  STATUS_MERGED,
  normalizeCreateIssueLabels,
  normalizeLabelIssueLabels,
  normalizedToolName,
} from "./taskingPolicy.js";
export { applyReplyGate, isActionTool, type ReplyGateInterceptedEvent, type ReplyGateOutcome } from "./replyGate.js";
export { toolKind, type ToolKind } from "./toolKinds.js";
export { SqliteStateStore } from "./state/sqlite.js";
export {
  AiSdkBrainLlm,
  createBrainLlm,
  PROVIDER_DEFAULTS,
  type AiLlmOptions,
  type LlmOperation,
  type LlmUsageReport,
  type Provider,
} from "./llm/aisdk.js";
export type {
  AnswerInput,
  AnswerResult,
  BacklogExtractInput,
  BacklogExtractResult,
  BrainLlm,
  Classification,
  ClassificationPage,
  ClassifyInput,
  ChatToolEvent,
  ComposePageInput,
  DriveSourceTools,
  PeerTool,
  PeerTools,
  VaultReadTools,
} from "./llm/types.js";
export * from "./connections/github.js";
