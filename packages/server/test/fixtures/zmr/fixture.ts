import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.json";

export { manifest };
export const multiTopic = `${manifest.marker}\nInsurance renewal confirmed. ${"Clear insurance detail. ".repeat(540)}\n\nProject launch confirmed. ${"Clear project detail. ".repeat(570)}\n\nUNCERTAIN: perhaps a third topic, destination unknown.`;
export const oversizedSummary = "Summary tail. ".repeat(1000);

// Frozen fixture serialization follows appendEvidence's on-disk format. Fixed anchors
// avoid random IDs in the ground truth; product writes still use appendEvidence.
function block(anchor: string, time: string, content: string): string {
  return `## ${time.slice(11, 16)} Synthetic capture  ^${anchor}\n- source: mcp\n- verbatim: yes\n- content-type: text\n- captured-at: ${time}\n- source-id: ZMR-${anchor}\n\n${content.split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
}
export async function seedFixture(path: string) {
  await cp(fileURLToPath(new URL("../../../../core/test/fixtures/vault", import.meta.url)), path, { recursive: true });
  // The inherited evidence retains valid historical citations; its single entry
  // is outside the synthetic seed count.
  const content = [
    `${manifest.marker}\n${"neutral padding ".repeat(600)}\nZMR ORCHID access word: cobalt-seventeen.`,
    `${manifest.marker}\nZMR ORCHID original launch color: amber.`,
    `${manifest.marker}\nCorrection: ZMR ORCHID launch color is now violet; amber is superseded.`,
    `${manifest.marker}\nZMR ORCHARD launch color: green. This is a different project.`,
    multiTopic,
  ];
  await mkdir(join(path, "Log"), { recursive: true });
  await writeFile(join(path, "Log/2026-01-01.md"), "# 2026-01-01\n\n" + content.map((text, i) => block(`e-${(i + 1).toString(16).padStart(6, "0")}`, `2026-01-01T0${i}:00:00.000Z`, text)).join(""));
  await writeFile(join(path, "Log/2026-09-01.md"), "# 2026-09-01\n\n" + Array.from({ length: manifest.fixture.fillerCount }, (_, i) => block(`e-${(i + 256).toString(16).padStart(6, "0")}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), `${manifest.marker}\nUnrelated filler ${i}.`)).join(""));
  await writeFile(join(path, "Notes/Oversized.md"), `---\ntitle: Oversized\ntype: note\ntags: [work]\ncreated: 2026-01-01\nupdated: 2026-01-01\nsummary: "${oversizedSummary}"\n---\n# Oversized\n[[Index]]\n`);
}
