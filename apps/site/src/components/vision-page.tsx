// zenod.dev/vision (E25-S5). Jordi, WhatsApp voice note 25 Nov 2026 14:34Z
// (obsidian-brain Log/2026-11-25.md#^e-3941fc): "each of the products that
// we're building should have a vision tab in the landing page ... For Zeno, for
// example, I think we're not so good at telling the bigger picture of you want
// to own it, like the importance of your context compounding ... It should be
// like slides, more like mini chapters ... a headline, a subtitle and a
// takeaway". So: eight frames, one idea each, a picture first, then the three
// beats. Every chapter carries a tag: "Why it matters" for the argument, "Live
// today" for what production does now (the same facts the home page shows),
// "The vision" for where we are going. Nothing about customers or numbers.
// Pictures are small looping scenes for lib/scenes.ts (data-at steps, data-off
// to take one away again); without script or with reduced motion each rests on
// its final frame.
import * as React from "react";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@/paper.css";
import "@/scenes.css";
import "@/vision.css";

import { startScenes } from "@/lib/scenes";

type Kind = "why" | "live" | "vision";

const KIND_LABEL: Record<Kind, string> = {
  why: "Why it matters",
  live: "Live today",
  vision: "The vision",
};

export interface VisionChapter {
  id: string;
  kind: Kind;
  headline: string;
  subtitle: string;
  takeaway: string;
  picture: () => React.ReactElement;
}

// 1. Every AI starts from zero: what it knew fades out of each new chat.
function ForgetPicture() {
  const tools = ["Claude", "ChatGPT", "Cursor"];
  const known = ["your project", "your people", "last week"];
  return (
    <svg className="vz-svg" viewBox="0 0 600 340" aria-hidden="true">
      {tools.map((name, t) => {
        const x = 12 + t * 198;
        return (
          <g key={name}>
            <rect className="vz-win" x={x} y="20" width="180" height="300" rx="8" />
            <line className="vz-hair" x1={x} x2={x + 180} y1="58" y2="58" />
            <text className="vz-t-sm" x={x + 16} y="45">{name}</text>
            {known.map((word, k) => (
              <g key={word} className="st" data-at={300 + t * 150 + k * 220} data-off={3400 + t * 120}>
                <rect className="vz-chip" x={x + 16} y={80 + k * 44} width="148" height="32" rx="16" />
                <text className="vz-t-sm" x={x + 30} y={101 + k * 44}>{word}</text>
              </g>
            ))}
            <g className="st" data-at={4000 + t * 200}>
              <text className="vz-t-serif" x={x + 90} y="180" textAnchor="middle">New chat</text>
              <text className="vz-t-faint" x={x + 90} y="206" textAnchor="middle">Remembers nothing</text>
            </g>
            <rect className="vz-input" x={x + 16} y="268" width="148" height="34" rx="17" />
          </g>
        );
      })}
    </svg>
  );
}

// 2. Context compounds: a staircase; each step adds memories that link back.
const STAIRS = ["Day 1", "Week 1", "Month 1", "Month 6", "Year 1"];
function stairDots() {
  const dots: { s: number; x: number; y: number }[] = [];
  STAIRS.forEach((_, s) => {
    const n = s + 1;
    for (let i = 0; i < n; i++) dots.push({ s, x: 30 + s * 112 + ((i + 0.5) * 100) / n, y: 278 - s * 56 - (i % 2) * 14 });
  });
  return dots;
}
function CompoundPicture() {
  const dots = stairDots();
  const links: { s: number; a: (typeof dots)[number]; b: (typeof dots)[number] }[] = [];
  dots.forEach((d, i) => {
    if (d.s === 0) return;
    const earlier = dots.slice(0, i).filter((e) => e.s < d.s);
    for (let k = 0; k < Math.min(d.s === STAIRS.length - 1 ? 2 : 1, earlier.length); k++) links.push({ s: d.s, a: d, b: earlier[(i * 3 + k * 5) % earlier.length] });
  });
  return (
    <svg className="vz-svg" viewBox="0 0 600 340" aria-hidden="true">
      <path className="vz-stair" d="M20 330 V300 H132 V244 H244 V188 H356 V132 H468 V76 H580" />
      {STAIRS.map((label, s) => (
        <g key={`l${label}`} className="st" data-at={300 + s * 900}>
          {links
            .filter((l) => l.s === s)
            .map((l, i) => (
              <path
                key={i}
                className={s === STAIRS.length - 1 ? "vz-link vz-link-new" : "vz-link"}
                d={`M${l.a.x} ${l.a.y} Q${(l.a.x + l.b.x) / 2} ${Math.min(l.a.y, l.b.y) - 40} ${l.b.x} ${l.b.y}`}
              />
            ))}
        </g>
      ))}
      {STAIRS.map((label, s) => (
        <g key={label} className="st" data-at={300 + s * 900}>
          <text className="vz-t-faint" x={76 + s * 112} y={326 - s * 56 + 2} textAnchor="middle">{label}</text>
          {dots
            .filter((d) => d.s === s)
            .map((d, i) => (
              <circle key={i} className={s === STAIRS.length - 1 ? "vz-dot vz-dot-new" : "vz-dot"} cx={d.x} cy={d.y} r="7" />
            ))}
        </g>
      ))}
    </svg>
  );
}

// 3. Rented memory stays behind; owned memory goes with you.
function OwnPicture() {
  return (
    <svg className="vz-svg" viewBox="0 0 600 340" aria-hidden="true">
      <text className="vz-t-sm vz-t-muted" x="150" y="30" textAnchor="middle">Inside an AI app</text>
      <rect className="vz-box" x="50" y="90" width="200" height="160" rx="6" />
      {[0, 1, 2].map((k) => (
        <line key={k} className="vz-hair" x1="80" x2={220 - k * 30} y1={130 + k * 30} y2={130 + k * 30} />
      ))}
      <g className="st" data-at="900">
        <path className="vz-lock" d="M135 92 V70 a15 15 0 0 1 30 0 V92" />
        <rect className="vz-lock-body" x="126" y="88" width="48" height="36" rx="4" />
      </g>
      <text className="vz-t-faint st" data-at="1800" x="150" y="290" textAnchor="middle">You can't read it or take it</text>

      <line className="vz-hair" x1="300" x2="300" y1="40" y2="310" />

      <text className="vz-t-sm vz-t-accent" x="450" y="30" textAnchor="middle">In your own folder</text>
      <path className="vz-folder" d="M350 110 h60 l14 16 h126 v124 h-200 z" />
      {["Log", "People", "Ideas"].map((name, k) => (
        <g key={name} className="st" data-at={2400 + k * 400}>
          <rect className="vz-file" x={364 + k * 60} y="146" width="52" height="72" rx="3" />
          <text className="vz-t-xs" x={390 + k * 60} y="238" textAnchor="middle">{name}</text>
        </g>
      ))}
      <text className="vz-t-faint vz-t-accent st" data-at="3800" x="450" y="290" textAnchor="middle">Read it, move it, keep it</text>
    </svg>
  );
}

// 4. Live today: plain Markdown files in your own Drive or GitHub.
const FILES = [
  { at: 400, path: "Log/2026-11-25.md", note: "your words, exactly" },
  { at: 1100, path: "People/Sara.md", note: "linked" },
  { at: 1800, path: "Ideas/Cookbook.md", note: "linked" },
  { at: 2500, path: "Plans/Birthday dinner.md", note: "linked" },
];
function FilesPicture() {
  return (
    <div className="vz-stage vz-files">
      <p className="vz-files-h">Your Google Drive &rsaquo; Zenod</p>
      <ul>
        {FILES.map((file) => (
          <li key={file.path} className="st" data-at={file.at}>
            <span className="vz-doc" aria-hidden="true" />
            <b>{file.path}</b>
            <small>{file.note}</small>
          </li>
        ))}
      </ul>
      <p className="vz-seal st" data-at="3400">Plain Markdown. Opens in Obsidian.</p>
    </div>
  );
}

// 5. Live today: one memory, every AI tool reads and writes it over MCP.
const TOOLS = ["Claude", "ChatGPT", "Codex", "Gemini CLI", "Cursor"];
function EveryAiPicture() {
  const cx = 300;
  const cy = 175;
  return (
    <svg className="vz-svg" viewBox="0 0 600 340" aria-hidden="true">
      {TOOLS.map((name, i) => {
        const a = (-90 + (i * 360) / TOOLS.length) * (Math.PI / 180);
        const x = cx + Math.cos(a) * 225;
        const y = cy + Math.sin(a) * 135;
        return (
          <g key={name} className="st" data-at={400 + i * 500}>
            <line className="vz-spoke" x1={cx} y1={cy} x2={x} y2={y} />
            <rect className="vz-pill" x={x - 62} y={y - 19} width="124" height="38" rx="19" />
            <text className="vz-t-sm" x={x} y={y + 6} textAnchor="middle">{name}</text>
          </g>
        );
      })}
      <circle className="vz-hub" cx={cx} cy={cy} r="62" />
      <text className="vz-t-hub" x={cx} y={cy - 4} textAnchor="middle">Your</text>
      <text className="vz-t-hub" x={cx} y={cy + 22} textAnchor="middle">memory</text>
    </svg>
  );
}

// 6. Live today: a voice note on a walk, filed and linked.
function VoicePicture() {
  return (
    <div className="vz-stage vz-voice">
      <div className="vz-phone">
        <p className="vz-bubble st" data-at="300">
          <span className="vz-play" aria-hidden="true" />
          <span className="vz-wave" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} style={{ height: `${28 + ((i * 41) % 72)}%` }} />
            ))}
          </span>
          0:12
        </p>
        <p className="vz-reply st" data-at="1500">Saved</p>
      </div>
      <span className="vz-arrow st" data-at="2200" aria-hidden="true" />
      <div className="vz-page st" data-at="2800">
        <p className="vz-page-h">Ideas/Cookbook.md</p>
        <p>A cookbook of the dinners we cook for friends.</p>
        <p className="vz-page-link st" data-at="3600">Linked to Plans/Birthday dinner.md</p>
      </div>
    </div>
  );
}

// 7. Live today: helpers read your library and leave a suggestion.
function HelpersPicture() {
  return (
    <div className="vz-stage vz-helpers">
      <p className="vz-helper st" data-at="200">
        <b>Ideas digest</b>
        <span data-type="Reading your last two weeks of notes" />
      </p>
      <div className="vz-suggest st" data-at="2600">
        <p>The cookbook idea from Tuesday fits Sara’s birthday dinner on Saturday.</p>
        <p className="vz-suggest-do">
          <span className="vz-btn-mini vz-btn-mini-on">Do it</span>
          <span className="vz-btn-mini">Not now</span>
        </p>
      </div>
    </div>
  );
}

// 8. The vision: models come and go along the top; your memory stays and grows.
function VisionPicture() {
  const models = ["This year’s model", "Next year’s model", "The one after"];
  return (
    <svg className="vz-svg" viewBox="0 0 600 340" aria-hidden="true">
      <text className="vz-t-faint" x="20" y="34">Models come and go</text>
      {models.map((name, i) => (
        <g key={name} className="st vz-model" data-at={300 + i * 1500} data-off={i < models.length - 1 ? 300 + (i + 1) * 1500 : undefined}>
          <rect className="vz-pill" x="190" y="54" width="220" height="44" rx="22" />
          <text className="vz-t-sm" x="300" y="82" textAnchor="middle">{name}</text>
        </g>
      ))}
      <line className="vz-spoke st" data-at="600" x1="300" y1="100" x2="300" y2="168" />
      <text className="vz-t-faint vz-t-accent" x="20" y="200">Your memory stays</text>
      {[0, 1, 2].map((r) => (
        <circle key={r} className={r === 2 ? "vz-ring vz-ring-new st" : "vz-ring st"} data-at={900 + r * 1500} cx="300" cy="258" r={34 + r * 22} />
      ))}
      <circle className="vz-hub" cx="300" cy="258" r="24" />
    </svg>
  );
}

export const VISION_CHAPTERS: VisionChapter[] = [
  {
    id: "start-from-zero",
    kind: "why",
    headline: "Every AI you use starts from zero.",
    subtitle:
      "Open a new chat and it has forgotten your work, your people and what you decided last week. So you explain it all again, in every tool.",
    takeaway: "The models are already smart. What they lack is you.",
    picture: ForgetPicture,
  },
  {
    id: "compounds",
    kind: "why",
    headline: "Context compounds.",
    subtitle:
      "A note from today links to one from March. A voice note from a walk joins a meeting from last year. Each new memory makes the old ones easier to find.",
    takeaway: "Every day you keep it, the whole of it gets more useful.",
    picture: CompoundPicture,
  },
  {
    id: "own-it",
    kind: "why",
    headline: "Memory you rent stays behind.",
    subtitle:
      "When an AI app keeps your memory inside its own walls, you cannot read it, move it or take it with you. Change tools and you start over.",
    takeaway: "Something that grows this valuable should belong to you.",
    picture: OwnPicture,
  },
  {
    id: "your-files",
    kind: "live",
    headline: "Your memory lives in your own Drive or GitHub.",
    subtitle:
      "Zenod writes plain Markdown to a folder you own. Your raw words are kept forever, exactly as you said them, and open in Obsidian or any editor.",
    takeaway: "If Zenod went away tomorrow, your memory would still be there.",
    picture: FilesPicture,
  },
  {
    id: "every-ai",
    kind: "live",
    headline: "One memory for every AI.",
    subtitle:
      "Claude, ChatGPT, Codex, Gemini CLI and Cursor connect to it over MCP. Each one reads what you know and saves what it learns.",
    takeaway: "Switch to a better model the day it comes out. Your context comes along.",
    picture: EveryAiPicture,
  },
  {
    id: "by-voice",
    kind: "live",
    headline: "Ideas come on walks. Keep them there.",
    subtitle:
      "Send a voice note on WhatsApp. Zenod writes it down, files it on the right page and links it to what you said before.",
    takeaway: "When keeping a thought takes ten seconds, you keep all of them.",
    picture: VoicePicture,
  },
  {
    id: "works-for-you",
    kind: "live",
    headline: "Then your memory starts working for you.",
    subtitle:
      "Helpers you switch on read your library. They find loose ends, connect an idea from Tuesday to a plan for Saturday and leave a suggestion in your inbox.",
    takeaway: "A library that gets read is worth more than one that only gets filled.",
    picture: HelpersPicture,
  },
  {
    id: "what-lasts",
    kind: "vision",
    headline: "Models will change. Your memory is what lasts.",
    subtitle:
      "Next year’s models will be smarter, and you will run many agents at once. Every one of them will need the same thing: to know you.",
    takeaway: "We are building the library they all read from, and you own it.",
    picture: VisionPicture,
  },
];

function Chapter({ chapter, no }: { chapter: VisionChapter; no: number }) {
  const Picture = chapter.picture;
  const total = String(VISION_CHAPTERS.length).padStart(2, "0");
  return (
    <section className={`vz-ch vz-ch-${chapter.kind}`} id={chapter.id} aria-labelledby={`${chapter.id}-title`}>
      <div className="vz-ch-in">
        <figure className="vz-pic scene" data-len="7000">
          <Picture />
        </figure>
        <div className="vz-say">
          <p className="vz-meta">
            <span className="vz-no">
              {String(no).padStart(2, "0")} / {total}
            </span>
            <span className={`vz-kind vz-kind-${chapter.kind}`}>{KIND_LABEL[chapter.kind]}</span>
          </p>
          <h2 id={`${chapter.id}-title`}>{chapter.headline}</h2>
          <p className="vz-sub">{chapter.subtitle}</p>
          <p className="vz-take">{chapter.takeaway}</p>
        </div>
      </div>
    </section>
  );
}

export function VisionPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  React.useEffect(() => startScenes(document), []);
  return (
    <div className="pp pp-vision">
      {nav}
      <main id="top">
        <section className="vz-hero" aria-labelledby="vision-title">
          <div className="vz-hero-text">
            <p className="vz-kicker">The vision</p>
            <h1 id="vision-title">The most valuable thing you give an AI is your context.</h1>
            <p className="vz-sub">
              Why Zenod exists, in eight short chapters: why your memory should be yours, and why it gets worth more every
              day you keep it.
            </p>
          </div>
          <ol className="vz-toc" aria-label="Chapters">
            {VISION_CHAPTERS.map((chapter, i) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>
                  <span className="vz-toc-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="vz-toc-h">{chapter.headline}</span>
                  <span className={`vz-kind vz-kind-${chapter.kind}`}>{KIND_LABEL[chapter.kind]}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        {VISION_CHAPTERS.map((chapter, i) => (
          <Chapter key={chapter.id} chapter={chapter} no={i + 1} />
        ))}

        <section className="vz-close" aria-labelledby="vision-close">
          <h2 id="vision-close">Start your library today.</h2>
          <p className="vz-sub">The sooner you start, the more it compounds.</p>
          <p className="pp-actions">
            <a className="pp-btn pp-btn-primary" href="/testers">
              Become a tester
            </a>
            <a className="pp-btn" href="/#how">
              See how it works
            </a>
          </p>
        </section>
      </main>
      {footer}
    </div>
  );
}
