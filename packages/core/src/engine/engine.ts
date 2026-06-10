import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { MEANING_FOLDERS } from "../vault/files.js";

export interface EngineOptions {
  repo: VaultRepo;
  llm: BrainLlm;
  state: StateStore;
  location?: VaultLocation;
  /** Override for tests. */
  now?: () => Date;
}

const COMPOSE_RETRIES = 2;

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

  async function vaultBriefing(): Promise<string> {
    const agents = await readFile(join(vaultPath, "AGENTS.md"), "utf8").catch(() => "");
    const snapshot = await scanVault(vaultPath);
    const index = snapshot.pages
      .map((p) => `${p.path} — ${p.title} [${p.tags.join(",")}]: ${p.summary}`)
      .join("\n");
    return [
      "You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.",
      "Search before answering; read the notes you cite; never invent vault content.",
      "Cite sources inline as vault paths. Be direct and concise.",
      agents ? `Vault doctrine:\n${agents}` : "",
      `Meaning pages:\n${index || "(none yet)"}`,
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
          if (!Object.keys(MEANING_FOLDERS).includes(page.path.split("/")[0] ?? "")) {
            throw new Error(`classifier proposed a non-meaning path: ${page.path}`);
          }
          const absolute = join(vaultPath, page.path);
          const currentContent = await readFile(absolute, "utf8").catch(() => null);

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
    const conversationId = `default:${surface}`;
    const window = await state.recentWindow(conversationId);
    await state.appendMessage(conversationId, "user", message, surface);

    const wantsStore = /\b(remember|store|save|capture|log) (this|that|it)\b/i.test(message);
    let stored: StoreResult | undefined;
    if (wantsStore) {
      stored = await store({ content: message, source: surface });
    }

    const result = await llm.answer(
      {
        question: message,
        vaultBriefing: await vaultBriefing(),
        conversation: window.map((m) => ({ role: m.role, text: m.text })),
      },
      readTools(),
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
    search: (query: string): Promise<Hit[]> => searchVault(vaultPath, query, location),
    get: (path: string): Promise<Note> => getNote(vaultPath, path, location),
    lint: (): Promise<LintReport> => lintVault(vaultPath),
  };
}
