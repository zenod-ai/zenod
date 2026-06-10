export const VERSION = "0.0.1";

export type {
  Answer,
  AttachmentInput,
  BrainEngine,
  ConversationMessage,
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
} from "./types.js";

export { loadBrainConfig, ConfigError, CONFIG_PATH, type BrainConfig } from "./vault/config.js";
export { parseNote, serializeNote, type ParsedNote } from "./vault/frontmatter.js";
export { listMarkdownFiles, tierOf, basenameOf, isIndexFile, MEANING_FOLDERS, type Tier, type MeaningType } from "./vault/files.js";
export { scanVault, extractPageLinks, extractCitations, type PageIndexEntry, type VaultSnapshot } from "./vault/pages.js";
export { lintVault } from "./vault/lint.js";
export { ensureSchemaV1 } from "./vault/migrate.js";
export { githubUrl, type VaultLocation } from "./vault/github.js";
export { searchVault } from "./ops/search.js";
export { getNote, NoteNotFoundError } from "./ops/get.js";
export { checkEvidenceImmutability, type FileChange } from "./vault/immutability.js";
export { WriteQueue } from "./git/queue.js";
export { VaultRepo, type VaultRepoOptions } from "./git/vaultRepo.js";
export { createEngine, type EngineOptions } from "./engine/engine.js";
export { appendEvidence, todayString, type EvidenceEntry } from "./engine/evidence.js";
export { SqliteStateStore } from "./state/sqlite.js";
export { AnthropicBrainLlm, type AnthropicLlmOptions } from "./llm/anthropic.js";
export type {
  AnswerInput,
  AnswerResult,
  BrainLlm,
  Classification,
  ClassificationPage,
  ClassifyInput,
  ComposePageInput,
  VaultReadTools,
} from "./llm/types.js";
