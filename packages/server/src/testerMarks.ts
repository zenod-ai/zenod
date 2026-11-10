// EPIC-26 S7 round 2 (Jordi, 2026-11-10: "I see that one applied. Was this like ourselves or is it like a
// real application?"): which tester applications are our own tests. A rule marks the obvious ones (the word
// TEST, our own domains, example addresses, the team list in ZENOD_TEAM_EMAILS); the operator can flip any
// application on cloud.zenod.dev/admin/testers, kept in a private file on the data volume. Tests count
// nowhere in the funnel, only as test_applications.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTesterEmail } from "./testerFlow.js";

export const TESTER_MARKS_FILE = "tester-marks.json";
const OUR_DOMAINS = new Set(["alpha9.io", "zenod.dev", "zenod.ai", "example.com", "example.org", "example.net"]);
const TEST_TLDS = /\.(test|invalid|example|localhost)$/i;

/** One key per applicant: the email in lower case, or the raw contact when it is not an email. */
export function applicantKey(contact: string): string {
  return (normalizeTesterEmail(contact) ?? contact.trim()).toLowerCase();
}

/** The rule alone: true when the application looks like one of ours. */
export function looksLikeOurTest(contact: string, use: string, teamEmails: ReadonlySet<string> = new Set()): boolean {
  const key = applicantKey(contact);
  if (teamEmails.has(key)) return true;
  if (/\btest\b|\+test/i.test(contact)) return true;
  // In what they wrote only the capital word counts: a stranger may well say they want to "test" Zenod.
  if (/\bTEST\b/.test(use)) return true;
  const domain = key.includes("@") ? key.slice(key.lastIndexOf("@") + 1) : "";
  return Boolean(domain) && (OUR_DOMAINS.has(domain) || TEST_TLDS.test(domain));
}

export function teamEmailsFromEnv(env: Record<string, string | undefined>): Set<string> {
  return new Set((env.ZENOD_TEAM_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

/** The rule plus the operator's own marks (test or real), which win. */
export class TesterMarks {
  private readonly path: string;

  constructor(private readonly dataDir: string, private readonly teamEmails: ReadonlySet<string> = new Set()) {
    this.path = join(dataDir, TESTER_MARKS_FILE);
  }

  private read(): Record<string, "test" | "real"> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { marks?: Record<string, "test" | "real"> };
      return parsed.marks && typeof parsed.marks === "object" ? parsed.marks : {};
    } catch {
      return {};
    }
  }

  /** "test" or "real", and whether the operator set it by hand. */
  mark(contact: string, use = ""): { test: boolean; byHand: boolean } {
    const own = this.read()[applicantKey(contact)];
    if (own) return { test: own === "test", byHand: true };
    return { test: looksLikeOurTest(contact, use, this.teamEmails), byHand: false };
  }

  isTest(contact: string, use = ""): boolean {
    return this.mark(contact, use).test;
  }

  set(contact: string, test: boolean): void {
    const key = applicantKey(contact);
    if (!key) return;
    const marks = this.read();
    marks[key] = test ? "test" : "real";
    mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ marks }, null, 1)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
