// How Zenod works, in five short animated moves, early on zenod.dev (EPIC-25,
// from Jordi's voice note of 2026-11-10): your raw words kept forever in your
// own Drive or GitHub; a cloud of thoughts with weighted links built from them
// (EPIC-18); helpers that read it and write new memories (EPIC-14); Zenod the
// librarian of your library; one memory every AI reads and writes. Each move
// is a scene for lib/scenes.ts (data-at steps, final frame without motion).
// Every claim holds for production today: the log is append-only and verbatim,
// strengths rank answers, helpers start off (E23-A2) and the weekly recap writes
// into its own folder, and cloud.zenod.dev/mcp signs any MCP client in with
// OAuth. WhatsApp only captures and acknowledges (root L-6), so its line runs
// one way, into the memory.
import * as React from "react";
import "@/moves.css";

import { MCP_SERVER_URL } from "@/lib/connect";

function Move({
  no,
  id,
  title,
  children,
  stage,
  building,
}: {
  no: string;
  id: string;
  title: string;
  /** EPIC-23 U7: a part of Zenod that is not ready yet gets a "Still building" label. */
  building?: boolean;
  children: React.ReactNode;
  stage: React.ReactNode;
}) {
  return (
    <article className="mv" id={id} aria-labelledby={`${id}-title`}>
      <div className="mv-say">
        <p className="mv-no">
          {no}
          {building ? <span className="mv-building">Still building</span> : null}
        </p>
        <h3 id={`${id}-title`}>{title}</h3>
        {children}
      </div>
      {stage}
    </article>
  );
}

// 1. Raw words in, kept forever, in a log that lives in your own account.
const KEPT_ENTRIES = [
  { at: 900, when: "09:12 · WhatsApp voice note", words: "“Ana can lend us her drill on Saturday, so we can start the shed.”" },
  { at: 2100, when: "09:40 · Photo", words: "shed-plan.jpg, the original file" },
  { at: 3300, when: "11:05 · Saved from Claude", words: "“Order cedar boards, they last longer outside.”" },
];

function KeptStage() {
  return (
    <div
      className="mv-stage scene mv-kept"
      data-len="9000"
      role="img"
      aria-label="A voice note, a photo and a note from Claude land word for word in today's log, which is written once, never edited, and kept in your Google Drive or GitHub."
    >
      <ul className="mv-in">
        <li className="st" data-at="200">
          <span className="mv-play" />
          <span className="mv-wave" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%` }} />
            ))}
          </span>
          0:42
        </li>
        <li className="st" data-at="1400">Photo</li>
        <li className="st" data-at="2600">From Claude</li>
      </ul>
      <div className="mv-doc">
        <p className="mv-doc-h">Log · 10 November</p>
        {KEPT_ENTRIES.map((entry) => (
          <p key={entry.when} className="mv-entry st" data-at={entry.at}>
            <small>{entry.when}</small>
            {entry.words}
          </p>
        ))}
        <p className="mv-seal st" data-at="4300">Written once. Never edited.</p>
      </div>
      <p className="mv-home st" data-at="5100">
        <span className="mv-folder" aria-hidden="true" /> In your Google Drive or GitHub
      </p>
    </div>
  );
}

// 2. From the list of literals to a cloud of thoughts: the thicker the line,
// the stronger the link. A new note joins at the end.
const CLOUD_NODES = [
  { id: "shed", label: "Garden shed", x: 330, y: 215, topic: true, at: 1500 },
  { id: "drill", label: "Ana’s drill", x: 135, y: 120, at: 1900 },
  { id: "cedar", label: "Cedar boards", x: 525, y: 105, at: 2200 },
  { id: "sat", label: "Saturday morning", x: 150, y: 330, at: 2500 },
  { id: "yard", label: "Timber yard", x: 540, y: 320, at: 2800 },
  { id: "leo", label: "Leo", x: 345, y: 395, at: 3100 },
  { id: "lisbon", label: "Lisbon trip", x: 70, y: 455, at: 3400, faint: true },
];
const CLOUD_LINKS: Array<{ a: string; b: string; w: number; at: number; label?: string }> = [
  { a: "shed", b: "cedar", w: 0.95, at: 2400, label: "0.95" },
  { a: "shed", b: "drill", w: 0.9, at: 2100, label: "0.9" },
  { a: "shed", b: "sat", w: 0.9, at: 2700 },
  { a: "drill", b: "sat", w: 0.8, at: 2900 },
  { a: "cedar", b: "yard", w: 0.77, at: 3000 },
  { a: "shed", b: "yard", w: 0.6, at: 3200 },
  { a: "sat", b: "leo", w: 0.85, at: 3300 },
  { a: "leo", b: "lisbon", w: 0.3, at: 3600, label: "0.3" },
];
const NEW_NODE = { label: "Shed roof idea", x: 480, y: 425 };

function CloudStage() {
  const at = (id: string) => CLOUD_NODES.find((node) => node.id === id)!;
  return (
    <div
      className="mv-stage scene mv-cloud"
      data-len="11000"
      role="img"
      aria-label="Three things you said become a cloud of linked thoughts around Garden shed. Thick lines are strong links, like 0.95 to Cedar boards, and faint ones are weak, like 0.3 to Lisbon trip. A new note, Shed roof idea, joins the cloud."
    >
      <ul className="mv-literals">
        <li className="st" data-at="200" data-off="1700">“Ana can lend us her drill on Saturday”</li>
        <li className="st" data-at="450" data-off="1800">“Order cedar boards”</li>
        <li className="st" data-at="700" data-off="1900">“Leo’s swimming is Saturday morning”</li>
      </ul>
      <svg viewBox="0 0 660 520" className="mv-cloud-svg" aria-hidden="true">
        <g className="mv-drift">
          {CLOUD_LINKS.map((link) => {
            const a = at(link.a);
            const b = at(link.b);
            const len = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
            return (
              <g key={`${link.a}-${link.b}`}>
                <line
                  className={link.w < 0.5 ? "mv-l mv-l-faint st" : "mv-l st"}
                  data-at={link.at}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  style={{ strokeWidth: 0.6 + Math.pow(link.w, 3) * 7, ["--len" as string]: len }}
                />
                {link.label ? (
                  <text className="mv-w st" data-at={link.at + 400} x={(a.x + b.x) / 2 + 8} y={(a.y + b.y) / 2 - 8}>
                    {link.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line
            className="mv-l mv-l-new st"
            data-at="6200"
            x1={at("shed").x}
            y1={at("shed").y}
            x2={NEW_NODE.x}
            y2={NEW_NODE.y}
            style={{ strokeWidth: 3.5, ["--len" as string]: 260 }}
          />
          {CLOUD_NODES.map((node) => (
            <g
              key={node.id}
              className={["mv-n", "st", node.topic ? "mv-n-topic" : "", node.faint ? "mv-n-faint" : ""].join(" ")}
              data-at={node.at}
            >
              <circle cx={node.x} cy={node.y} r={node.topic ? 13 : 8} />
              <text x={node.x} y={node.topic ? node.y - 24 : node.y > 250 ? node.y + 32 : node.y - 17} textAnchor="middle">
                {node.label}
              </text>
            </g>
          ))}
          <g className="mv-n mv-n-new st" data-at="5800">
            <circle className="mv-ring" cx={NEW_NODE.x} cy={NEW_NODE.y} r={14} />
            <circle cx={NEW_NODE.x} cy={NEW_NODE.y} r={9} />
            <text x={NEW_NODE.x} y={NEW_NODE.y + 34} textAnchor="middle">
              {NEW_NODE.label}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

// 3. Helpers read the memory at night and add to it: the weekly recap writes a
// new memory into its own folder, another helper leaves a suggestion.
function HelpersStage() {
  return (
    <div
      className="mv-stage scene mv-helpers"
      data-len="11000"
      role="img"
      aria-label="At night the Weekly recap helper reads the 23 memories you saved this week and writes a recap into its own folder, which becomes a new memory. The Health of your memory helper leaves a suggestion in your inbox: file 4 loose pages under Garden shed, with Do it and Not now."
    >
      <div className="mv-helper st" data-at="200">
        <p className="mv-helper-name">
          <span className="mv-moon" aria-hidden="true" /> Weekly recap
        </p>
        <p className="mv-helper-do" data-type="Reading the 23 memories you saved this week…" />
        <span className="mv-scan st" data-at="600" data-off="3600" aria-hidden="true" />
      </div>
      <div className="mv-out">
        <div className="mv-note st" data-at="3700">
          <p className="mv-tag-new">New memory</p>
          <b>Your week, 3 to 9 November</b>
          <p>The shed got going: boards ordered, drill on Saturday. Leo’s swimming moved to mornings.</p>
          <small>In the helper’s own folder of your library</small>
        </div>
        <div className="mv-card st" data-at="5600">
          <p className="mv-card-from">Suggestion · Health of your memory</p>
          <b>File 4 loose pages under Garden shed?</b>
          <p className="mv-card-act">
            <span className="mv-do">Do it</span>
            <span>Not now</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// 4. The library is yours; Zenod stands at its door, on the way in and out.
function LibrarianStage() {
  return (
    <div
      className="mv-stage scene mv-lib"
      data-len="11500"
      role="img"
      aria-label="A voice note comes in. Zenod, at the door of your library in your own Google Drive, files it, labels it Garden shed, adds it to the index and links it in the graph. Then a question comes in, and Zenod brings back the answer with its source."
    >
      <div className="mv-lane">
        <span className="mv-pkt st" data-at="200">
          Voice note
        </span>
        <span className="mv-pkt mv-pkt-q st" data-at="5600">
          When can we start the shed?
        </span>
        <span className="mv-pkt mv-pkt-a st" data-at="8000">
          Saturday, with Ana’s drill · <u>source</u>
        </span>
      </div>
      <div className="mv-gate">
        <span className="mv-z">Z</span>
        <b>Zenod</b>
        <ul>
          <li className="st" data-at="1100">Filed</li>
          <li className="st" data-at="1700">Labelled: Garden shed</li>
          <li className="st" data-at="2300">Added to the index</li>
          <li className="st" data-at="2900">Linked in the graph</li>
          <li className="st mv-fetch" data-at="6400">Fetched from the shelf</li>
        </ul>
      </div>
      <div className="mv-shelf">
        <p className="mv-shelf-h">Your library</p>
        <div className="mv-books" aria-hidden="true">
          {["Home", "Leo", "Work", "Lisbon", "Recipes", "Garden shed"].map((name, index) => (
            <span
              key={name}
              className={index === 5 ? "mv-book mv-book-new st" : "mv-book"}
              data-at={index === 5 ? 3300 : undefined}
              style={{ height: `${70 + ((index * 23) % 30)}%` }}
            >
              {name}
            </span>
          ))}
        </div>
        <p className="mv-shelf-f">Your Google Drive or GitHub · you own it</p>
      </div>
    </div>
  );
}

export const FiveMoves = React.memo(function FiveMoves() {
  return (
    <section className="mv-sec" id="how-zenod-works" aria-labelledby="moves-title">
      <div className="mv-head">
        <p className="mv-kicker">How Zenod works</p>
        <h2 id="moves-title">Your words go in. A living memory grows out of them.</h2>
      </div>

      <Move no="1" id="forever" title="We keep your words forever, exactly as you said them." stage={<KeptStage />}>
        <p>
          Every voice note, photo and message lands first in a dated log, word
          for word. Zenod writes each entry once and never changes it.
        </p>
        <p>
          The log lives in your own Google Drive or GitHub from the first
          second. You never have to export it, because it was never ours.
        </p>
      </Move>

      <Move no="2" id="cloud" title="From your words, a cloud of thoughts." stage={<CloudStage />}>
        <p>
          Zenod reads what you kept and links each thought to the ones it
          touches. A note filed on a page is a strong link, a passing mention a
          faint one.
        </p>
        <p>
          Every new note joins the cloud, and when you ask, Zenod follows the
          strong links first.
        </p>
      </Move>

      <Move no="3" id="helpers" title="Helpers read it and add new memories." stage={<HelpersStage />} building>
        <p>
          Helpers are small readers that wake at night. The weekly recap reads
          your week and writes a short recap into its own folder of your
          library, where it becomes a memory like any other.
        </p>
        <p>
          Others suggest a tidy-up, and you answer Do it or Not now from your
          inbox. Every helper starts off, and you switch on the ones you want.
        </p>
        <p>
          Helpers are still being built. Your memory works fully without them.
        </p>
      </Move>

      <Move no="4" id="librarian" title="Zenod is the librarian. The library stays yours." stage={<LibrarianStage />}>
        <p>
          You give Zenod a folder in your own Google Drive or GitHub. Zenod
          stands at the door: it files what comes in, labels it, keeps the
          index and the graph, and fetches what you ask for.
        </p>
        <p>
          Your memory lives in your account as plain files. Stop using Zenod
          and every file stays where it is.
        </p>
      </Move>
    </section>
  );
});

// 5. One memory in the middle that every AI reads and writes. WhatsApp writes
// in; MCP tools read and write. Replaces the old MCP path figure, same #mcp.
const SPOKES: Array<{ name: string; x: number; y: number; oneWay?: boolean }> = [
  { name: "WhatsApp", x: 169, y: 125, oneWay: true },
  { name: "Claude", x: 360, y: 65 },
  { name: "ChatGPT", x: 551, y: 125 },
  { name: "Codex", x: 630, y: 270 },
  { name: "Gemini CLI", x: 551, y: 415 },
  { name: "Cursor", x: 360, y: 475 },
  { name: "VS Code", x: 169, y: 415 },
  { name: "Any MCP tool", x: 90, y: 270 },
];
const HUB = { x: 360, y: 270 };

export const OneMemorySection = React.memo(function OneMemorySection() {
  const host = MCP_SERVER_URL.replace("https://", "");
  return (
    <section className="pp-mcp mv-one" id="mcp" aria-labelledby="mcp-title">
      <div className="pp-mcp-say">
        <p className="mv-no">5</p>
        <h2 id="mcp-title">One memory that every AI reads and writes.</h2>
        <p>
          Your memory sits in the middle and keeps all your tools on the same
          page. Drop things in from WhatsApp. Claude, ChatGPT, Codex, Gemini
          CLI, Cursor, VS Code and any tool that speaks MCP can search it, read
          it and save to it, from any computer.
        </p>
        <p className="pp-actions">
          <a className="pp-btn pp-btn-primary" href="/connect">
            Connect your AI tool
          </a>
        </p>
        <p className="pp-fine">
          Your tools reach it over MCP, from the cloud: add {host} once as a
          connector and sign in with Google or GitHub. Listed in the official
          MCP Registry as dev.zenod/memory.
        </p>
      </div>
      <figure className="pp-mcp-fig">
        <div
          className="mv-stage scene mv-hub"
          data-len="9000"
          role="img"
          aria-label="Your memory in the middle. WhatsApp writes into it. Claude, ChatGPT, Codex, Gemini CLI, Cursor, VS Code and any MCP tool read from it and write to it."
        >
          <svg viewBox="0 0 720 540" aria-hidden="true">
            {SPOKES.map((spoke, index) => {
              const dx = HUB.x - spoke.x;
              const dy = HUB.y - spoke.y;
              return (
                <g key={spoke.name} className="mv-spoke st" data-at={300 + index * 250}>
                  <line x1={spoke.x} y1={spoke.y} x2={HUB.x} y2={HUB.y} />
                  <circle
                    className={spoke.oneWay ? "mv-dot mv-dot-in" : "mv-dot"}
                    cx={spoke.x}
                    cy={spoke.y}
                    r={6}
                    style={{
                      ["--dx" as string]: `${dx}px`,
                      ["--dy" as string]: `${dy}px`,
                      animationDelay: `${index * 0.37}s`,
                    }}
                  />
                </g>
              );
            })}
            <g className="mv-core st" data-at="100">
              <circle cx={HUB.x} cy={HUB.y} r={108} />
              <text x={HUB.x} y={HUB.y - 6} textAnchor="middle" className="mv-core-t">
                Your memory
              </text>
              <text x={HUB.x} y={HUB.y + 24} textAnchor="middle" className="mv-core-s">
                in your Drive or GitHub
              </text>
            </g>
            {SPOKES.map((spoke, index) => (
              <g key={spoke.name} className={spoke.oneWay ? "mv-tool mv-tool-in st" : "mv-tool st"} data-at={300 + index * 250}>
                <rect x={spoke.x - 74} y={spoke.y - 24} width={148} height={48} rx={24} />
                <text x={spoke.x} y={spoke.y + 7} textAnchor="middle">
                  {spoke.name}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <figcaption>
          WhatsApp writes in. Every connected AI tool reads and writes.
        </figcaption>
      </figure>
    </section>
  );
});
