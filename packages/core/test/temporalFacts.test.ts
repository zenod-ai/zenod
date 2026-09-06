import { describe, expect, it } from "vitest";
import { appendMemoryFacts, parseMemoryFacts, projectFacts, renderFactViews, type FactProposal } from "../src/engine/temporalFacts.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import type { MemoryEntry } from "../src/types.js";
const proposal = (statement: string, options: Partial<FactProposal> = {}): FactProposal => ({ key: "orchid.color", statement, effectiveDate: null, effectiveDateQuote: null, correctionQuote: null, supersedesQuotes: [], verificationQuote: null, ...options });
const entry = (n: number, content: string): MemoryEntry => ({ evidenceRef: `Log/2026-09-06.md#^e-${String(n).padStart(6, "0")}`, path: "Log/2026-09-06.md", anchor: `e-${String(n).padStart(6, "0")}`, title: "Local fixture", content, source: "mcp", verbatim: true, capturedAt: "2026-09-06T10:00:00Z", url: "https://example.invalid/evidence", provider: "github", revisionId: "test-sha" });
const seed = () => serializeNote({ title: "Orchid", type: "note", summary: "Project color" }, "## History\n\nOriginal history and citation [[2026-06-10#^e-7f3a2c]].\n");
const facts = (raw: string) => parseMemoryFacts(parseNote(raw).frontmatter?.memoryFacts);
const now = new Date("2026-09-06T12:00:00Z");
describe("source-qualified temporal facts", () => {
  it("keeps three explicit successive changes and reconstructs effective time despite later capture dates", async () => {
    let raw = seed(); const originals: string[] = []; const entries = new Map<string, MemoryEntry>();
    for (const [n, color, date, prior] of [[1,"amber","2026-01-01",null],[2,"violet","2026-02-01","amber"],[3,"blue","2026-03-01","violet"]] as const) {
      const statement = `Orchid color is ${color}.`;
      const correctionQuote = prior ? `Correction: replace "Orchid color is ${prior}." with "${statement}" effective ${date}.` : null;
      const evidence = entry(n, `Synthetic test data. ${correctionQuote ?? statement + " Effective " + date}`); entries.set(evidence.evidenceRef, evidence);
      originals.push(raw);
      raw = appendMemoryFacts(raw, raw, [proposal(statement, { effectiveDate: date, effectiveDateQuote: evidence.content, correctionQuote, supersedesQuotes: prior ? [`Orchid color is ${prior}.`] : [] })], evidence);
    }
    expect(facts(raw)).toHaveLength(3);
    expect(parseNote(raw).body).toContain(parseNote(originals[0]!).body);
    const read = async (asOf?: string) => projectFacts({ path: "Notes/Orchid.md", ...(asOf ? { asOf } : {}) }, facts(raw), now, async ref => entries.get(ref)!);
    const current = await read(); expect(current.facts.map(f => f.status)).toEqual(["superseded","superseded","active"]);
    expect(renderFactViews([current])).toContain('Orchid color is blue.'); expect(renderFactViews([current])).not.toContain('Orchid color is amber.');
    const past = await read("2026-01-20"); expect(past.facts.map(f => f.status)).toEqual(["active","future","future"]);
    expect(renderFactViews([past])).toContain("Synthetic fixture");
    expect((await read("2026-02-20")).facts.map(f => f.status)).toEqual(["superseded","active","future"]);
  });
  it("retains ambiguous corrections, contradictory sources and unknown dates without latest-write-wins", async () => {
    let raw = seed(); const entries = new Map<string, MemoryEntry>();
    for (const [n, statement] of [[1, "Orchid color is amber."], [2, "Orchid color is blue."]] as const) {
      const evidence = entry(n, statement); entries.set(evidence.evidenceRef, evidence);
      raw = appendMemoryFacts(raw, raw, [proposal(statement, n === 2 ? { correctionQuote: "Correction: the old value is wrong", supersedesQuotes: ["ambiguous old value"] } : {})], evidence);
    }
    const view = await projectFacts({ path: "Notes/Orchid.md" }, facts(raw), now, async ref => entries.get(ref)!);
    expect(view.facts.map(f => f.status)).toEqual(["conflict", "conflict"]); expect(view.facts[1]!.supersedes).toEqual([]);
    const historical = await projectFacts({ path: "Notes/Orchid.md", asOf: "2026-02-01" }, facts(raw), now, async ref => entries.get(ref)!);
    expect(historical.facts.map(f => f.status)).toEqual(["undated", "undated"]);
    expect(renderFactViews([historical])).toContain("Effective date unknown");
  });
  it("cannot forge quotes/dates/records or supersede across synthetic and reported sources", async () => {
    const e1 = entry(1, "Synthetic fixture. Orchid color is amber.");
    let raw = appendMemoryFacts(seed(), seed(), [proposal("Orchid color is amber.", { effectiveDate: "2026-02-30", verificationQuote: "invented check" }), proposal("invented fact")], e1);
    expect(facts(raw)).toHaveLength(1); expect(facts(raw)[0]).toMatchObject({ effectiveDate: null, verificationQuote: null });
    const statement = "Orchid color is blue."; const correctionQuote = `Correction: replace "Orchid color is amber." with "${statement}".`;
    const e2 = entry(2, correctionQuote);
    raw = appendMemoryFacts(raw, raw, [proposal(statement, { correctionQuote, supersedesQuotes: ["Orchid color is amber."] })], e2);
    expect(facts(raw)[1]).toMatchObject({ origin: "user_report", unresolvedCorrection: true, supersedes: [] });
    const forged = facts(raw); forged[1]!.supersedes = [forged[0]!.id]; forged[1]!.unresolvedCorrection = false;
    const view = await projectFacts({ path: "Notes/Orchid.md" }, forged, now, async ref => ref === e1.evidenceRef ? e1 : e2);
    expect(view.facts.every(f => f.status === "active")).toBe(true); // distinct scopes, no cross-origin suppression
    const noProof = await projectFacts({ path: "Notes/Orchid.md" }, forged, now, async () => { throw new Error("missing"); });
    expect(noProof.facts.every(f => f.status === "unsupported")).toBe(true); expect(renderFactViews([noProof])).not.toContain(statement);
    const fabricated = appendMemoryFacts(serializeNote({ memoryFacts: forged }, "Body"), null, [], e1);
    expect(facts(fabricated)).toEqual([]);
  });
  it("legacy notes disclose unknown state and missing fix is never proof of a current bug", async () => {
    const view = await projectFacts({ path: "Notes/Legacy.md" }, undefined, now, async () => { throw new Error("must not read"); });
    expect(view.legacy).toBe(true); expect(renderFactViews([view])).toContain("not proof of absence");
    expect(renderFactViews([view])).toContain("An absent fix record never proves");
    await expect(projectFacts({ path: "Notes/Legacy.md", asOf: "2026-02-30" }, [], now, async () => entry(1,"x"))).rejects.toThrow("real YYYY-MM-DD");
  });
  it("marks a bounded or malformed projection partial instead of inventing a complete active state", async () => {
    let raw = seed(); const entries = new Map<string, MemoryEntry>();
    for (let n = 1; n <= 33; n++) {
      const evidence = entry(n, `Claim ${n}.`); entries.set(evidence.evidenceRef, evidence);
      raw = appendMemoryFacts(raw, raw, [proposal(`Claim ${n}.`, { key: `fact.${n}` })], evidence);
    }
    const view = await projectFacts({ path: "Notes/Orchid.md" }, facts(raw), now, async ref => entries.get(ref)!);
    expect(view.complete).toBe(false); expect(view.facts).toHaveLength(32);
    const narrow = await projectFacts({ path: "Notes/Orchid.md", key: "fact.33" }, facts(raw), now, async ref => entries.get(ref)!);
    expect(narrow.complete).toBe(true); expect(narrow.facts[0]!.statement).toBe("Claim 33.");
    const malformed = await projectFacts({ path: "Notes/Orchid.md" }, [{ invented: true }], now, async () => entry(1,"x"));
    expect(malformed.complete).toBe(false);
    const custom = serializeNote({ memoryFacts: "legacy custom field" }, "Old body");
    const retained = appendMemoryFacts(custom, custom, [proposal("New claim")], entry(1,"New claim"));
    expect(parseNote(retained).frontmatter!.memoryFacts).toBe("legacy custom field");
  });

  it("does not infer effective dates or verification from unrelated, negated, planned or future quotes", async () => {
    const statement = "Orchid color is blue.";
    for (const quote of ["The old policy was effective 2026-01-01. Orchid color is blue.", "Orchid color is blue. The unrelated check was effective 2026-01-01.", "Orchid color is blue. Not effective 2026-01-01."]) {
      const raw = appendMemoryFacts(seed(), seed(), [proposal(statement, { effectiveDate: "2026-01-01", effectiveDateQuote: quote })], entry(1,quote));
      expect(facts(raw)[0]!.effectiveDate).toBeNull(); expect(facts(raw)[0]!.effectiveDateQuote).toBeNull();
    }
    for (const quote of ["Not verified on 2026-01-01 in production.", "Will be tested on 2026-01-01 in local environment.", "Verified on 2027-01-01 in production.", "Production mentioned on 2026-01-01.", "Verified in production, date unknown."]) {
      const raw = appendMemoryFacts(seed(), seed(), [proposal(statement, { verificationQuote: quote })], entry(1,`${statement} ${quote}`));
      expect(facts(raw)[0]!.verificationQuote).toBeNull();
    }
    const old = entry(1,"Orchid color is amber.");
    const original = appendMemoryFacts(seed(),seed(),[proposal(old.content)],old);
    const correctionQuote = 'Do not replace "Orchid color is amber." with "Orchid color is blue.".';
    const raw = appendMemoryFacts(original,original,[proposal(statement,{ correctionQuote, supersedesQuotes: [old.content] })],entry(2,correctionQuote));
    expect(facts(raw)[1]).toMatchObject({ supersedes: [], unresolvedCorrection: true });
  });

});
