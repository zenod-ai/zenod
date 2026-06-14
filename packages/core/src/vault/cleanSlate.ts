import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VaultRepo } from "../git/vaultRepo.js";
import type { LintReport } from "../types.js";
import { githubUrl, type VaultLocation } from "./github.js";
import { lintVault } from "./lint.js";
import { ensureSchemaV1 } from "./migrate.js";

export interface CleanSlateOptions {
  /** Push each commit after it is created. Default false for local/test safety. */
  push?: boolean;
  location?: VaultLocation;
  now?: () => Date;
}

export interface CleanSlateResult {
  vaultPath: string;
  branch: string;
  initialCommitSha: string;
  setupCommitSha: string;
  initialPaths: string[];
  setupPaths: string[];
  topLevelPaths: string[];
  githubUrls: string[];
  lint: LintReport;
  inspect: string[];
  revert: string[];
}

const INITIAL_PATHS = [
  "README.md",
  "AGENTS.md",
  "index.md",
  "Inbox/.gitkeep",
  "Log/.gitkeep",
  "Projects/.gitkeep",
  "Areas/.gitkeep",
  "Notes/.gitkeep",
  "Archive/.gitkeep",
  "_attachments/.gitkeep",
] as const;

const TOP_LEVEL_PATHS = [
  "README.md",
  "AGENTS.md",
  "index.md",
  "Inbox/",
  "Log/",
  "Projects/",
  "Areas/",
  "Notes/",
  "Archive/",
  "_attachments/",
  "_templates/",
  ".brain/",
] as const;

function dateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function readme(): string {
  return `# Zenod Vault

This vault starts as a clean slate for Zenod.

- Capture unresolved material in \`Inbox/\`.
- Preserve source evidence in append-only \`Log/\` files and \`_attachments/\`.
- Distill durable meaning into \`Projects/\`, \`Areas/\`, and \`Notes/\`.
- Expose the vault as a strict Open Knowledge Format (OKF) profile through \`index.md\` and compatible frontmatter.
- Use git history to inspect or revert each setup step.
`;
}

function agents(): string {
  return `# Vault Operating Rules

- Preserve evidence. Do not rewrite existing \`Log/\` entries or files in \`_attachments/\`.
- Cite evidence from meaning pages with links to \`Log/YYYY-MM-DD.md\` anchors.
- Keep meaning-page frontmatter OKF-compatible: \`type\` is required by OKF; \`description\` mirrors Zenod \`summary\`; \`timestamp\` mirrors the last meaningful update.
- Ask before guessing when a capture cannot be filed confidently.
- Keep user-authored meaning pages in \`Projects/\`, \`Areas/\`, and \`Notes/\`.
`;
}

function index(created: string): string {
  return `---
okf_version: "0.1"
---

# Index

Created ${created} as a Zenod clean-slate vault.

## Start Here

- [[Areas/Areas Index|Areas]]
- Inbox captures live in \`Inbox/\` until they can be filed.
- Evidence receipts live in \`Log/\` and \`_attachments/\`.
`;
}

async function writeInitialFile(vaultPath: string, relPath: string, content: string): Promise<void> {
  const absolute = join(vaultPath, relPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

function dirtyPaths(status: Awaited<ReturnType<VaultRepo["status"]>>): string[] {
  return [
    ...status.created,
    ...status.modified,
    ...status.deleted,
    ...status.renamed.map((r) => r.to),
    ...status.not_added,
  ].sort();
}

/**
 * Build a new Zenod vault in two auditable commits:
 * 1. human-readable clean-slate shell;
 * 2. Zenod schema/setup files.
 *
 * The command is intentionally non-destructive. It only runs in an empty git
 * repository/worktree, and refuses any tracked or untracked user content.
 */
export async function cleanSlateVault(repo: VaultRepo, options: CleanSlateOptions = {}): Promise<CleanSlateResult> {
  const status = await repo.status();
  const dirty = dirtyPaths(status);
  if (dirty.length > 0) {
    throw new Error(`clean-slate requires an empty working tree; found: ${dirty.join(", ")}`);
  }

  const tracked = await repo.trackedFiles();
  if (tracked.length > 0) {
    throw new Error(`clean-slate only runs against an empty vault repo; found tracked files: ${tracked.join(", ")}`);
  }

  const created = dateString(options.now?.() ?? new Date());
  await writeInitialFile(repo.path, "README.md", readme());
  await writeInitialFile(repo.path, "AGENTS.md", agents());
  await writeInitialFile(repo.path, "index.md", index(created));
  for (const relPath of INITIAL_PATHS) {
    if (relPath.endsWith(".gitkeep")) await writeInitialFile(repo.path, relPath, "");
  }

  let initialCommitSha = await repo.commit("clean-slate: initial vault");
  if (options.push) initialCommitSha = await repo.push();

  const setupPaths = await ensureSchemaV1(repo.path);
  let setupCommitSha = await repo.commit("clean-slate: initialize Zenod schema");
  if (options.push) setupCommitSha = await repo.push();

  const lint = await lintVault(repo.path);
  const location = options.location ?? {};
  const reportPaths = [...INITIAL_PATHS, ...setupPaths];

  return {
    vaultPath: repo.path,
    branch: repo.branch,
    initialCommitSha,
    setupCommitSha,
    initialPaths: [...INITIAL_PATHS],
    setupPaths,
    topLevelPaths: [...TOP_LEVEL_PATHS],
    githubUrls: reportPaths.map((path) => githubUrl(location, path)).filter(Boolean),
    lint,
    inspect: [
      `git -C ${repo.path} show --stat ${initialCommitSha}`,
      `git -C ${repo.path} show --stat ${setupCommitSha}`,
      `git -C ${repo.path} log --oneline -2`,
    ],
    revert: [
      `git -C ${repo.path} revert ${setupCommitSha}`,
      `git -C ${repo.path} revert ${initialCommitSha}`,
    ],
  };
}
