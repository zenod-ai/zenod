/**
 * Demo vault shaped like Jordi's "what was in my last vn?" (EPIC-12 S3c round 2, 2026-11-08):
 * the latest voice note is about screenshots, branding and Epic Social and was filed into three
 * topic pages (a fourth was planned and never written); unrelated tree roots (Agent Team, Epic
 * Team, Hair transplant, Travel, EpicSpine) each say "last" somewhere, which is how they all tied
 * at 22 % before. Made-up words throughout; no private content.
 */

const page = (title: string, body: string, parent?: string) =>
  `---\ntitle: ${title}\ntype: note\n${parent ? `parent: "${parent}"\n` : ""}---\n\n# ${title}\n\n${body}\n`;

const entry = (time: string, title: string, anchor: string, source: string, contentType: string | null, words: string) =>
  [`## ${time} ${title}  ^${anchor}`, `- source: ${source}`, "- verbatim: yes", ...(contentType ? [`- content-type: ${contentType}`] : []), "",
    ...words.split("\n").map((line) => `> ${line}`), ""].join("\n");

const receipt = (evidenceRef: string, filed: string[], planned: string[]) => [
  "---", "status: filing-record", `evidence: ${JSON.stringify(evidenceRef)}`, "---", "", "# Topic filing receipt", "",
  "```json",
  JSON.stringify({
    version: 1, evidenceRef, inputFingerprint: "demo", filingRevision: "demo", baseRevision: { provider: "git", id: "demo" }, phase: "ready",
    classification: { topics: [...filed, ...planned].map((path, i) => ({ ideaId: `i${i}`, topic: path, pages: [{ path }] })) },
    outcomes: [
      ...filed.map((path, i) => ({ topic: path, ideaId: `i${i}`, evidenceRef, sourceSpans: [], confidence: 0.8, disposition: "integrate_page", pages: [path], filedPages: [path], status: "filed" })),
      ...planned.map((path, i) => ({ topic: path, ideaId: `p${i}`, evidenceRef, sourceSpans: [], confidence: 0.6, disposition: "integrate_page", pages: [path], filedPages: [], status: "pending" })),
    ],
    files: {},
  }, null, 2),
  "```", "",
].join("\n");

export const LATEST_VOICE_NOTE = "Log/2026-11-08.md#^e-5c0e11";
export const OLDER_VOICE_NOTE = "Log/2026-11-07.md#^e-7a0e22";
export const UNLINKED_VOICE_NOTE = "Log/2026-11-06.md#^e-6b0e33";

export const LAST_VOICE_NOTE_VAULT: Record<string, string> = {
  "Tree.md": [
    "---", "title: Tree", "---", "", "# Memory tree", "", "## Working memory", "",
    "- Agent Team | working | [[Projects/Agent Team]] | The agent team and how it works day to day.",
    "- Epic Team | working | [[Projects/Epic Team]] | The Epic Team product and its brand.",
    "- Epic Social | working | [[Projects/Epic Social]] | Epic Social: posts, screenshots and videos for social channels.",
    "", "## Long-term memory", "",
    "- Hair transplant | long-term | [[Areas/Hair transplant]] | Plans and clinics for a hair transplant.",
    "- Travel | long-term | [[Areas/Travel]] | Trips, flights and places.",
    "- EpicSpine | long-term | [[Areas/EpicSpine]] | The EpicSpine way of running work.",
    "",
  ].join("\n"),
  "Projects/Agent Team.md": page("Agent Team", "The team of agents. The last review moved the desk to a new console."),
  "Projects/Epic Team.md": page("Epic Team", "Epic Team, the product. The last pricing call kept the free tier."),
  "Projects/Epic Team/Brand identity.md": page("Brand identity",
    "- Every screenshot carries the logo and the brand background, never a raw capture [[2026-11-08#^e-5c0e11]]\n- Colours stay the house palette.",
    "[[Projects/Epic Team]]"),
  "Projects/Epic Social.md": page("Epic Social", "Posts, screenshots and short videos for social channels. The last launch post did well."),
  "Projects/Epic Social/Branded screenshots.md": page("Branded screenshots",
    "- Screenshots should be polished and uncluttered, with a background and the logo, made the same way every time [[2026-11-08#^e-5c0e11]]\n- A demo animation can reuse the same frame [[2026-11-08#^e-5c0e11]]",
    "[[Projects/Epic Social]]"),
  "Projects/Epic Social/Explainer videos.md": page("Explainer videos",
    "- Agree on the base diagram and keyframes first, then animate it with a voice [[2026-11-08#^e-5c0e11]]",
    "[[Projects/Epic Social]]"),
  "Areas/Hair transplant.md": page("Hair transplant", "The last consult said wait until spring."),
  "Areas/Travel.md": page("Travel", "Trips and flights. The last trip was to the coast.\n- Book the train to the coast early this time [[2026-11-07#^e-7a0e22]]"),
  "Areas/EpicSpine.md": page("EpicSpine", "How work runs: spines, rows and reviews. The last version added cards."),
  "Log/2026-11-06.md": ["# 2026-11-06", "", entry("21:10", "A thought about the garden fence", "e-6b0e33", "whatsapp", "voice_note",
    "A thought about the garden fence, the paint is peeling and the gate sticks.")].join("\n"),
  "Log/2026-11-07.md": ["# 2026-11-07", "", entry("18:02", "Train to the coast", "e-7a0e22", "whatsapp", "voice_note",
    "Remember to book the train to the coast early this time, prices go up.")].join("\n"),
  "Log/2026-11-08.md": ["# 2026-11-08", "",
    entry("05:55", "zenod-social, EPIC-12 deploy note", "e-a9e044", "mcp", null, "zenod-social, EPIC-12 S3c merged and deployed on 07238de."),
    entry("06:40", "Screenshots, demos and explainer videos", "e-5c0e11", "whatsapp", "voice_note",
      "I want making screenshots, demos, animations and explainer videos to become a repeatable Epic Social capability. Screenshots should be polished and uncluttered, with a background and the logo, brand consistent. For explainer videos we agree on the base diagram and keyframes first, then animate it with a voice."),
    entry("06:52", "Typed reminder", "e-c0ffee", "web", "text", "Buy coffee beans."),
  ].join("\n"),
  "Inbox/filing-2026-11-08-e-5c0e11.md": receipt(LATEST_VOICE_NOTE,
    ["Projects/Epic Social/Branded screenshots.md", "Projects/Epic Social/Explainer videos.md", "Projects/Epic Team/Brand identity.md"],
    ["Projects/Epic Social/Animations.md"]),
};
