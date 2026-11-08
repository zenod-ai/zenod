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
