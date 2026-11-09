import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readLogCaptures } from "../vault/captureOrigin.js";
import { listMarkdownFiles, MEANING_FOLDERS } from "../vault/files.js";
import { CITATION_RE } from "../vault/pages.js";
import { isAgentOpsReport, OPS_ROLLUP_HEADING, TrackedWrites } from "./treePlacement.js";

/**
 * E12-S8 fix 4 (S6 round 5, cause "not your memory"): before the ops-report filter
 * went live (E9-2h, 2026-11-01) agent reports were filed onto the person's pages as
 * if the person had said them. A report line is a line on a meaning page whose every
 * Log citation is an agent report, other than the dated `- <date> ops (<n>):` lines of
 * the page's `## Ops rollup` section. E12-S15: topic filing used to append report
 * lines after that section, so they sat under its heading; they count too.
 *
 * `planReportLines` only reads. `moveReportLines` moves each planned line, byte for
 * byte, to `Archive/Agent reports/Moved report lines.md` under a heading naming its
 * page and line, so the change is logged and can be put back; the caller reviews and
 * commits it as one revision. Log/ and _attachments/ are never written.
 */
export const MOVED_REPORT_LINES_PATH = "Archive/Agent reports/Moved report lines.md";
/** A rollup line (E9-2b rule 5): the agent-reports index of its node, kept where it is. */
const ROLLUP_LINE_RE = /^- \d{4}-\d{2}-\d{2} ops \(\d+\): /;

export interface ReportLine {
  page: string;
  /** 1-based line number in the page file. */
  line: number;
  text: string;
  /** `YYYY-MM-DD#^e-xxxxxx` of every agent report the line cites. */
  citations: string[];
}

export interface ReportLinesPlan {
  pagesScanned: number;
  /** Lines on meaning pages that cite at least one Log entry. */
  citedLines: number;
  lines: ReportLine[];
}

export async function planReportLines(vaultPath: string): Promise<ReportLinesPlan> {
  const files = await listMarkdownFiles(vaultPath);
  const captures = await readLogCaptures(vaultPath, files.filter(file => file.startsWith("Log/")));
  const plan: ReportLinesPlan = { pagesScanned: 0, citedLines: 0, lines: [] };
  for (const page of files.filter(file => MEANING_FOLDERS[file.split("/")[0] ?? ""])) {
    const raw = await readFile(join(vaultPath, page), "utf8").catch(() => null);
    if (raw === null) continue;
    plan.pagesScanned++;
    const lines = raw.split("\n");
    // Skip frontmatter: line 0 is `---` and the block ends at the next `---`.
    let i = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0;
    let inRollup = false;
    for (; i < lines.length; i++) {
      const text = lines[i]!;
      if (/^## /.test(text)) { inRollup = text.trim() === OPS_ROLLUP_HEADING; continue; }
      if ((inRollup && ROLLUP_LINE_RE.test(text)) || /^#/.test(text)) continue;
      const citations = [...text.matchAll(CITATION_RE)].map(match => `${match[1]}#^${match[2]}`);
      if (!citations.length) continue;
      plan.citedLines++;
      const reports = citations.map(key => captures.get(key));
      if (reports.every(capture => capture && isAgentOpsReport(`${capture.title}\n${capture.content}`, capture.source))) {
        plan.lines.push({ page, line: i + 1, text, citations: [...new Set(citations)] });
      }
    }
  }
  return plan;
}

/** Move the planned lines to the archive page; returns the paths written. A line whose text changed since planning stays. */
export async function moveReportLines(vaultPath: string, plan: ReportLinesPlan, today: string, writes: TrackedWrites = new TrackedWrites(vaultPath)): Promise<string[]> {
  const byPage = new Map<string, ReportLine[]>();
  for (const line of plan.lines) byPage.set(line.page, [...(byPage.get(line.page) ?? []), line]);
  const moved: string[] = [];
  for (const [page, planned] of byPage) {
    const raw = await readFile(join(vaultPath, page), "utf8");
    const lines = raw.split("\n");
    const remove = new Set(planned.filter(line => lines[line.line - 1] === line.text).map(line => line.line - 1));
    if (!remove.size) continue;
    await writes.write(page, lines.filter((_, index) => !remove.has(index)).join("\n"));
    for (const index of [...remove].sort((a, b) => a - b)) {
      moved.push(`## ${today} from [[${page.replace(/\.md$/, "")}]] line ${index + 1}\n\n${lines[index]}\n`);
    }
  }
  if (!moved.length) return writes.paths;
  const existing = await readFile(join(vaultPath, MOVED_REPORT_LINES_PATH), "utf8").catch(() => null);
  const head = existing ?? [
    "---", "title: Moved report lines", "type: note", "tags: []", `created: ${today}`, `updated: ${today}`,
    "summary: Agent report lines moved off the person's pages, each with the page and line it came from.", "---", "",
    "# Moved report lines", "",
    "Agent reports filed onto your pages before the report filter existed. Each line is kept here exactly as it was, under the page and line it came from, so it can be put back.", "",
  ].join("\n");
  await writes.write(MOVED_REPORT_LINES_PATH, `${head}${head.endsWith("\n") ? "" : "\n"}\n${moved.join("\n")}`);
  return writes.paths;
}

/**
 * E12-S29: the person's own lines that sit under a page's `## Ops rollup` heading (topic
 * filing appended after the rollup section before E12-S29). The rollup section keeps its
 * intro, its dated rollup lines and any agent report line (those are `planReportLines`'
 * to move); every other line is the person's and belongs above it.
 */
export interface RollupLinesPage {
  page: string;
  /** 1-based line numbers, in page order, and their text. */
  lines: { line: number; text: string }[];
}

const ROLLUP_INTRO = "Agent ops reports (";

export async function planRollupLines(vaultPath: string): Promise<RollupLinesPage[]> {
  const files = await listMarkdownFiles(vaultPath);
  const captures = await readLogCaptures(vaultPath, files.filter(file => file.startsWith("Log/")));
  const out: RollupLinesPage[] = [];
  for (const page of files.filter(file => MEANING_FOLDERS[file.split("/")[0] ?? ""])) {
    const raw = await readFile(join(vaultPath, page), "utf8").catch(() => null);
    if (raw === null || !raw.includes(`\n${OPS_ROLLUP_HEADING}\n`)) continue;
    const lines = raw.split("\n");
    const found: RollupLinesPage["lines"] = [];
    let inRollup = false;
    for (let i = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0; i < lines.length; i++) {
      const text = lines[i]!;
      if (/^## /.test(text)) { inRollup = text.trim() === OPS_ROLLUP_HEADING; continue; }
      if (!inRollup || !text.trim() || ROLLUP_LINE_RE.test(text) || text.startsWith(ROLLUP_INTRO)) continue;
      const citations = [...text.matchAll(CITATION_RE)].map(match => captures.get(`${match[1]}#^${match[2]}`));
      if (citations.length && citations.every(capture => capture && isAgentOpsReport(`${capture.title}\n${capture.content}`, capture.source))) continue;
      found.push({ line: i + 1, text });
    }
    if (found.length) out.push({ page, lines: found });
  }
  return out;
}

/**
 * Move each planned line, text unchanged and in its order, to just above the rollup
 * heading it sat under (the end of the section before it). Blank lines between moved
 * lines stay with them; a page whose lines changed since planning is left alone.
 * Returns the paths written; the caller commits them as one revision.
 */
export async function moveRollupLines(vaultPath: string, plan: RollupLinesPage[], writes: TrackedWrites = new TrackedWrites(vaultPath)): Promise<string[]> {
  for (const { page, lines: planned } of plan) {
    const lines = (await readFile(join(vaultPath, page), "utf8")).split("\n");
    if (planned.some(line => lines[line.line - 1] !== line.text)) continue;
    const moving = new Set(planned.map(line => line.line - 1));
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i]!.trim() !== OPS_ROLLUP_HEADING) { out.push(lines[i++]!); continue; }
      let end = i + 1;
      while (end < lines.length && !/^## /.test(lines[end]!)) end++;
      const indexes = [...Array(end - i - 1).keys()].map(k => k + i + 1);
      const moved = indexes.filter(k => moving.has(k));
      if (!moved.length) { out.push(...lines.slice(i, end)); i = end; continue; }
      // The moved block runs from the first to the last moved line, blank lines inside it kept.
      const block = lines.slice(moved[0], moved.at(-1)! + 1).filter((text, k) => moving.has(moved[0]! + k) || !text.trim())
        .join("\n").replace(/\n{3,}/g, "\n\n").split("\n");
      while (out.length && !out.at(-1)!.trim()) out.pop();
      out.push("", ...block, "");
      const kept = indexes.filter(k => !moving.has(k)).map(k => lines[k]!);
      // Collapse the blank lines the move left behind in the rollup section.
      const section = [lines[i]!, ...kept].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
      out.push(...section.split("\n"), ...(end < lines.length ? [""] : []));
      i = end;
    }
    let next = out.join("\n");
    if (!next.endsWith("\n")) next += "\n";
    await writes.write(page, next);
  }
  return writes.paths;
}
