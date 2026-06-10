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
export { checkEvidenceImmutability, type FileChange } from "./vault/immutability.js";
