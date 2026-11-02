export { VERSION } from "./version.js";

export type {
  Answer,
  AskOptions,
  BacklogCandidate,
  BacklogCandidateType,
  BacklogDifficulty,
  BacklogDigestInput,
  BacklogDigestResult,
  BacklogOwner,
  BacklogPriority,
  BacklogSourceRef,
  GitHubBacklogSourceRef,
  BacklogStatus,
  AttachmentInput,
  BrainEngine,
  ChatTestAuditInput,
  ChatTestAuditRecord,
  ChatTestStatus,
  ChatOptions,
  ConversationCaptureIdentity,
  ConversationCaptureTicket,
  ConversationMessage,
  ExternalTaskingTools,
  EnrichEvidenceInput,
  Hit,
  LintError,
  LintReport,
  MemoryContentType,
  MemoryEntry,
  MemoryEntryQuery,
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
  TreeSweepInput,
  TreeSweepResult,
  WorkInput,
  WorkResult,
} from "./types.js";
export { ContextRefError, EVIDENCE_CONTEXT_REF_PATTERN } from "./types.js";

export { loadBrainConfig, ConfigError, CONFIG_PATH, type BrainConfig } from "./vault/config.js";
export { parseNote, serializeNote, type ParsedNote } from "./vault/frontmatter.js";
export { listMarkdownFiles, tierOf, basenameOf, isIndexFile, MEANING_FOLDERS, type Tier, type MeaningType } from "./vault/files.js";
export { scanVault, extractPageLinks, extractCitations, type PageIndexEntry, type VaultSnapshot } from "./vault/pages.js";
export { lintVault } from "./vault/lint.js";
export {
  TREE_PATH, PARENT_FIELD, MEMORY_FIELD, TREE_PARENT, MAX_TREE_DEPTH, MEMORY_KINDS, GROUP_HEADINGS,
  parseTree, readTree, formatTreeNode, pagePathFromRef, pageTreeFields, isTreeParentRef, isTreePage,
  buildTreeIndex, createTreeIndex, formatLineage,
  type MemoryKind, type TreeNode, type ParsedTree, type TreeParseProblem, type PageTreeFields,
  type LineageStep, type LineageResult, type TreeIndex,
} from "./vault/tree.js";
export { lintTree, lintTreeIndex, type TreeLintIssue, type TreeLintReport, type TreeLintStats } from "./vault/treeLint.js";
export { seedTreeFiles, renderTreeFile, renderRootPage, type SeedNode, type SeedFile } from "./vault/treeSeed.js";
export { heat as treeHeat, jaccard, matchRootIds, newRootId } from "./engine/treeIdentity.js";
export { memoryTreeOutline, pageCaptureDate, type MemoryTreeOutline, type MemoryTreeOutlineNode, type MemoryTreeCapture } from "./vault/treeOutline.js";
export { MemoryIndex, MemoryIndexTenantError, type MemoryIndexHit, type MemoryIndexOptions, type MemoryIndexStats } from "./vault/memoryIndex.js";
export { loadMemoryTree, formatMemoryLineage, type MemoryTreeIndex, type MemoryLineage, type MemoryTreeNodeView, type LineageNode } from "./vault/lineage.js";
export { isAgentOpsReport, parseFiledLines, OPS_ROLLUP_HEADING, FILED_PREFIX } from "./engine/treePlacement.js";
export {
  runTreeSweep,
  rediscoverTree,
  refileAgentLeaves,
  assertSweepChangesSafe,
  ARCHIVE_INBOX_DIR,
  type TreeSweepReport,
  type TreeSweepCounts,
  type TreeSweepOptions,
} from "./engine/treeSweep.js";
export { discoverTree, applyTreeDiscovery, type DiscoveredRoot, type TreeDiscoveryPlan, type TreeDiscoveryOptions } from "./engine/treeDiscover.js";
export { captureOrigin, readLogCaptures, type CaptureOrigin, type LogCapture } from "./vault/captureOrigin.js";
export { ensureSchemaV1 } from "./vault/migrate.js";
export { cleanSlateVault, type CleanSlateOptions, type CleanSlateResult } from "./vault/cleanSlate.js";
export { githubSourceRef, githubUrl, type VaultLocation } from "./vault/github.js";
export {
  VaultPublicationError,
  assertVaultProviderUrl,
  githubVaultRevision,
  type VaultProvider,
  type VaultCitation,
  type VaultPublicationOutcome,
  type VaultPublicationFailure,
  type VaultRepository,
  type VaultRevision,
  type VaultSourceRef,
} from "./vault/repository.js";
export {
  assertDriveTransactionInvariant,
  assertDriveIdempotentReplay,
  driveTransactionIdempotencyScope,
  isDriveTransactionTerminal,
  type DriveFilePrecondition,
  type DriveMutationKind,
  type DriveMutationState,
  type DriveTransactionMutation,
  type DriveTransactionState,
  type DriveVaultTransaction,
} from "./vault/driveTransaction.js";
export {
  DriveVaultRepository,
  type DriveVaultAuthorityBinding,
  type DriveVaultClient,
  type DriveVaultFile,
  type DriveVaultPrecondition,
  type DriveVaultRevisionRecord,
  type DriveVaultRepositoryOptions,
} from "./vault/driveRepository.js";
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
export { createEngine, type EngineOptions } from "./engine/engine.js";
export { conversationId } from "./conversation.js";
export {
  appendEvidence,
  getEvidenceEntry,
  searchEvidenceEntries,
  todayString,
  type EvidenceEntry,
  type EvidenceMetadata,
} from "./engine/evidence.js";
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
  authorizeTurnPlanOperation,
  DEFAULT_TRUSTED_CONNECTION_PROFILE,
  isTrustedConnectionProfile,
  type ConnectionExposure,
  type ConnectionFinancialScope,
  type ConnectionTenantScope,
  type HostAuthorizationDecision,
  type HostAuthorizationDisposition,
  type McpRiskAnnotations,
  type TrustedConnectionProfile,
} from "./taskingPolicy.js";
export { applyReplyGate, isActionTool, type ReplyGateInterceptedEvent, type ReplyGateOutcome } from "./replyGate.js";
export {
  hasMutationSuccessClaim,
  renderVerifiedMutationReceipt,
  validateMutationReceipt,
  type MutationReceiptEvidence,
  type MutationReceiptValidation,
} from "./mutationReceipt.js";
export { isKnownTool, toolKind, type ToolKind } from "./toolKinds.js";
export { SqliteStateStore } from "./state/sqlite.js";
export {
  AiSdkBrainLlm,
  createBrainLlm,
  LlmAllowanceExceededError,
  isLlmAllowanceExceededError,
  PROVIDER_DEFAULTS,
  type AiLlmOptions,
  type LlmOperation,
  type LlmUsageReport,
  type Provider,
} from "./llm/aisdk.js";
export {
  TURN_PLAN_COMPILER_VERSION,
  bindTurnPlan,
  turnPlanIntentSchema,
  turnPlanDispositionSchema,
  turnPlanModelSchema,
  turnPlanPrompt,
  type TurnPlan,
  type TurnPlanCompilation,
  type TurnPlanCompileInput,
  type TurnPlanDisposition,
  type TurnPlanError,
  type TurnPlanErrorCode,
  type TurnPlanIntent,
  type TurnPlanMetadata,
  type TurnPlanModelOutput,
  type TurnPlanOperation,
  type TurnPlanPayload,
  type TurnPlanTool,
} from "./llm/turnPlan.js";
export type {
  AnswerInput,
  AnswerResult,
  BacklogExtractInput,
  BacklogExtractResult,
  BrainLlm,
  TurnPlanCompiler,
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
export {
  JevClient,
  JevUnavailableError,
  assembleClassification,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_TIMEOUT_MS,
  type JevClientOptions,
  type JevVerdict,
} from "./llm/jev.js";
export {
  withJevClassify,
  isJevEligible,
  JEV_DEFAULT_CONFIDENCE_THRESHOLD,
  JEV_DEFAULT_BREAKER_FAILURES,
  JEV_DEFAULT_BREAKER_COOLDOWN_MS,
  type ClassifyOutcome,
  type JevClassifyOptions,
  type JevFallbackReason,
} from "./llm/classifyFallback.js";
export * from "./connections/github.js";

export { selectMemoryEntries, memoryTimestamp } from "./engine/evidence.js";
export { paginateMemoryEntries, memoryEntrySummaries, type MemoryEntryPage, type EntrySearchInput, type EntrySearchResult } from "./engine/entryPagination.js";
export type { AnswerCoverage } from "./engine/retrievalCoverage.js";
