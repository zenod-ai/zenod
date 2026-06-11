import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type {
  Answer,
  BrainEngine,
  Hit,
  LintReport,
  Note,
  Reply,
  StateStore,
  StoreInput,
  StoreResult,
  Surface,
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
import { WriteQueue } from "../git/queue.js";
import type { VaultRepo } from "../git/vaultRepo.js";
import type { BrainLlm, Classification } from "../llm/types.js";
import { appendEvidence, todayString } from "./evidence.js";
import { listAttachmentFiles, MEANING_FOLDERS } from "../vault/files.js";

export interface EngineOptions {
  repo: VaultRepo;
  llm: BrainLlm;
  state: StateStore;
  location?: VaultLocation;
  /** Override for tests. */
  now?: () => Date;
  /**
   * Max staleness the read path tolerates before pulling from origin.
   * Writes always pull; without this, reads could serve a stale snapshot
   * indefinitely. 0 = pull on every read (tests).
   */
  readSyncTtlMs?: number;
}

const COMPOSE_RETRIES = 2;
const WORK_RETRIES = 2;
const DEFAULT_READ_SYNC_TTL_MS = 60_000;

const DEFAULT_TEMPLATE = `---
title: "{{title}}"
type: {{type}}
tags: []
created: "{{date}}"
updated: "{{date}}"
summary: ""
---

# {{title}}
`;

export function createEngine(options: EngineOptions): BrainEngine {
  const { repo, llm, state } = options;
  const vaultPath = repo.path;
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
    if (now().getTime() - lastSyncMs < readSyncTtl) return;
    await queue.run(async () => {
      if (now().getTime() - lastSyncMs < readSyncTtl) return; // a queued turn already synced
      await repo.pull().catch(() => {});
      lastSyncMs = now().getTime();
    });
  }

  async function vaultBriefing(): Promise<string> {
    const agents = await readFile(join(vaultPath, "AGENTS.md"), "utf8").catch(() => "");
    const snapshot = await scanVault(vaultPath);
    const index = snapshot.pages
      .map((p) => `${p.path} — ${p.title} [${p.tags.join(",")}]: ${p.summary}`)
      .join("\n");
    const logs = snapshot.files.filter((f) => f.startsWith("Log/")).join("\n");
    const attachments = (await listAttachmentFiles(vaultPath)).join("\n");
    return [
      "You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.",
      "Search before answering; read the notes you cite; never invent vault content.",
      "The vault has two tiers. Meaning pages (Projects/, Areas/, Notes/) hold distilled knowledge. The evidence tier holds the originals: Log/ daily files contain immutable receipts — verbatim transcripts, quotes, and source links (e.g. Google Drive URLs) — and _attachments/ holds raw artifacts (images, documents).",
      "For provenance questions (where is the original / audio / transcript / source?), read the Log file bodies and the '## Sources' section of meaning pages — that is where artifact locations live.",
      "Summaries are lossy. Before concluding something is not in the vault, read the full bodies of the top search hits, and search again with different terms.",
      "Cite sources inline as vault paths. Be direct and concise.",
      agents ? `Vault doctrine:\n${agents}` : "",
      `Meaning pages:\n${index || "(none yet)"}`,
      `Evidence logs:\n${logs || "(none yet)"}`,
      `Attachments:\n${attachments || "(none yet)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function readTools() {
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

  /**
   * The librarian work loop — propose (read-only plan) then execute (approved
   * plan, validated, one commit per objective). The model arranges the working
   * tree; this function guarantees what lands: lint + evidence immutability,
   * commit-and-push or full rollback. Same contract as store, wider verbs.
   */
  async function work(input: WorkInput): Promise<WorkResult> {
    if (!input.plan) {
      await syncForRead();
      const result = await llm.work(
        { objective: input.objective, vaultBriefing: await vaultBriefing() },
        readTools(),
      );
      return { mode: "proposal", text: result.text, committed: false };
    }

    return queue.run(async (): Promise<WorkResult> => {
      await repo.pull().catch(() => {});
      lastSyncMs = now().getTime();

      let loopInput = {
        objective: input.objective,
        plan: input.plan,
        vaultBriefing: await vaultBriefing(),
      } as import("../llm/types.js").WorkLoopInput;

      for (let attempt = 0; attempt <= WORK_RETRIES; attempt++) {
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

  /** The librarian pipeline — docs/M0-SPEC.md § The librarian pipeline. */
  async function store(input: StoreInput): Promise<StoreResult> {
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
      return {
        evidenceRef,
        pagesTouched: touched,
        commitSha: sha,
        githubUrls: [
          githubUrl(location, evidence.logPath),
          ...touched.map((p) => githubUrl(location, p)),
        ].filter(Boolean),
      };
    });
  }

  async function ask(question: string): Promise<Answer> {
    await syncForRead();
    const result = await llm.answer(
      { question, vaultBriefing: await vaultBriefing(), conversation: [] },
      readTools(),
    );
    return {
      text: result.text,
      sources: result.readPaths.map((path) => ({ path, githubUrl: githubUrl(location, path) })),
    };
  }

  async function chat(message: string, surface: Surface): Promise<Reply> {
    await syncForRead();
    const conversationId = `default:${surface}`;
    const window = await state.recentWindow(conversationId);
    await state.appendMessage(conversationId, "user", message, surface);

    const wantsStore = /\b(remember|store|save|capture|log) (this|that|it)\b/i.test(message);
    let stored: StoreResult | undefined;
    if (wantsStore) {
      stored = await store({ content: message, source: surface });
    }

    const taskTools = {
      proposeTask: async (objective: string) => {
        const proposal = await work({ objective });
        return proposal.text;
      },
      executeTask: async (objective: string, plan: string) => {
        const executed = await work({ objective, plan });
        return [
          executed.mode === "failed" ? "FAILED (rolled back, nothing committed)" : "DONE",
          executed.text,
          ...(executed.commitSha ? [`commit: ${executed.commitSha}`] : []),
          ...(executed.changedPaths?.length ? [`changed: ${executed.changedPaths.join(", ")}`] : []),
        ].join("\n");
      },
    };

    const result = await llm.answer(
      {
        question: message,
        vaultBriefing: await vaultBriefing(),
        conversation: window.map((m) => ({ role: m.role, text: m.text })),
      },
      readTools(),
      taskTools,
    );
    await state.appendMessage(conversationId, "assistant", result.text, surface);

    return {
      text: result.text,
      sources: result.readPaths.map((path) => ({ path, githubUrl: githubUrl(location, path) })),
      ...(stored ? { stored } : {}),
    };
  }

  return {
    store,
    ask,
    chat,
    work,
    search: async (query: string): Promise<Hit[]> => {
      await syncForRead();
      return searchVault(vaultPath, query, location);
    },
    get: async (path: string): Promise<Note> => {
      await syncForRead();
      return getNote(vaultPath, path, location);
    },
    lint: async (): Promise<LintReport> => {
      await syncForRead();
      return lintVault(vaultPath);
    },
  };
}
