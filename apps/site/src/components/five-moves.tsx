// How Zenod works on zenod.dev, one animated diagram per idea (EPIC-25). E25-S3
// iteration 2 (Jordi, vn_668d73df, 2026-11-18): one normal person's week as the
// example everywhere (a friend's birthday, a dentist visit, a work meeting), no
// made-up names; connecting every agent moved up to 3; the librarian drawn with
// arrows; the raw and organized copies told plainly; the library is yours as a
// diagram (voice note to Zenod to your Drive or GitHub); helpers last, as agents
// that mine your memory for connections. Each stage is a scene for
// lib/scenes.ts (data-at steps, final frame without motion). Every claim holds
// for production today: the log is append-only and verbatim, strengths rank
// answers, the helpers run (personaCatalog.ts) and write only in their own
// folder, and cloud.zenod.dev/mcp signs any MCP client in with OAuth. WhatsApp
// only captures and acknowledges (root L-6), so its line runs one way, in.
import * as React from "react";
import "@/moves.css";

import { MCP_SERVER_URL } from "@/lib/connect";

function Move({
  no,
  id,
  title,
  children,
  stage,
}: {
  no: string;
  id: string;
  title: string;
  children: React.ReactNode;
  stage: React.ReactNode;
}) {
  return (
    <article className="mv" id={id} aria-labelledby={`${id}-title`}>
      <div className="mv-say">
        <p className="mv-no">{no}</p>
        <h3 id={`${id}-title`}>{title}</h3>
        {children}
      </div>
      {stage}
    </article>
  );
}

// 1. Raw words in, kept forever, in a log that lives in your own account.
const KEPT_ENTRIES = [
  { at: 900, when: "09:12 · WhatsApp voice note", words: "“Sara’s birthday is Saturday. I’ll book dinner for six.”" },
  { at: 2100, when: "09:40 · Photo", words: "concert-tickets.jpg, the original file" },
  { at: 3300, when: "11:05 · Saved from Claude", words: "“Dentist moved to Thursday at 4. Leave the team meeting early.”" },
];

export function KeptStage() {
  return (
    <div
      className="mv-stage scene mv-kept"
      data-len="9000"
      role="img"
      aria-label="A voice note about a friend's birthday dinner, a photo of concert tickets and a note from Claude about a dentist visit land word for word in today's log, which is written once, never edited, and kept in your Google Drive or GitHub."
    >
      <ul className="mv-in">
        <li className="st" data-at="200">
          <span className="mv-play" />
          <span className="mv-wave" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%` }} />
            ))}
          </span>
          0:09
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
  { id: "bday", label: "Sara’s birthday", x: 330, y: 215, topic: true, at: 1500 },
  { id: "dinner", label: "Dinner for six", x: 135, y: 120, at: 1900 },
  { id: "tickets", label: "Concert tickets", x: 525, y: 105, at: 2200 },
  { id: "sat", label: "Saturday", x: 150, y: 330, at: 2500 },
  { id: "sara", label: "Sara", x: 540, y: 320, at: 2800 },
  { id: "week", label: "This week", x: 345, y: 395, at: 3100 },
  { id: "meeting", label: "Team meeting", x: 70, y: 455, at: 3400, faint: true },
];
const CLOUD_LINKS: Array<{ a: string; b: string; w: number; at: number; label?: string }> = [
  { a: "bday", b: "tickets", w: 0.95, at: 2400, label: "0.95" },
  { a: "bday", b: "dinner", w: 0.9, at: 2100, label: "0.9" },
  { a: "bday", b: "sat", w: 0.9, at: 2700 },
  { a: "dinner", b: "sat", w: 0.8, at: 2900 },
  { a: "tickets", b: "sara", w: 0.77, at: 3000 },
  { a: "bday", b: "sara", w: 0.6, at: 3200 },
  { a: "sat", b: "week", w: 0.85, at: 3300 },
  { a: "week", b: "meeting", w: 0.3, at: 3600, label: "0.3" },
];
const NEW_NODE = { label: "Gift: a cookbook", x: 480, y: 425 };

export function CloudStage() {
  const at = (id: string) => CLOUD_NODES.find((node) => node.id === id)!;
  return (
    <div
      className="mv-stage scene mv-cloud"
      data-len="11000"
      role="img"
      aria-label="Three things you said become a cloud of linked thoughts around Sara's birthday. Thick lines are strong links, like 0.95 to Concert tickets, and faint ones are weak, like 0.3 to Team meeting. A new note, Gift: a cookbook, joins the cloud."
    >
      <ul className="mv-literals">
        <li className="st" data-at="200" data-off="1700">“Sara’s birthday is Saturday”</li>
        <li className="st" data-at="450" data-off="1800">“Two concert tickets”</li>
        <li className="st" data-at="700" data-off="1900">“Leave the team meeting early”</li>
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
            x1={at("bday").x}
            y1={at("bday").y}
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

// 3. One memory in the middle that every AI reads and writes. WhatsApp writes
// in; MCP tools read and write.
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

function HubStage() {
  return (
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
  );
}

// An arrow between two columns: across on wide screens, down on phones.
function Arrow({ at, back, label }: { at: number; back?: boolean; label?: string }) {
  return (
    <span className={back ? "mv-arrow mv-arrow-back st" : "mv-arrow st"} data-at={at} aria-hidden="true">
      {label ? <small>{label}</small> : null}
    </span>
  );
}

// 4. The library is yours; Zenod stands at its door, on the way in and out.
function LibrarianStage() {
  return (
    <div
      className="mv-stage scene mv-lib"
      data-len="11500"
      role="img"
      aria-label="An arrow carries a voice note into Zenod, which files it, labels it Sara's birthday, adds it to the index and links it in the graph, and an arrow puts it on the shelf of your library. Then a question goes in, and an arrow brings back the answer, dinner for six on Saturday, with its source."
    >
      <div className="mv-lane">
        <span className="mv-pkt st" data-at="200">
          Voice note
        </span>
        <span className="mv-pkt mv-pkt-q st" data-at="5600">
          What did I plan for Sara?
        </span>
        <span className="mv-pkt mv-pkt-a st" data-at="8000">
          Dinner for six, Saturday · <u>source</u>
        </span>
      </div>
      <div className="mv-arrows">
        <Arrow at={700} label="in" />
        <Arrow at={7600} back label="answer" />
      </div>
      <div className="mv-gate">
        <span className="mv-z">Z</span>
        <b>Zenod</b>
        <ul>
          <li className="st" data-at="1100">Filed</li>
          <li className="st" data-at="1700">Labelled: Sara’s birthday</li>
          <li className="st" data-at="2300">Added to the index</li>
          <li className="st" data-at="2900">Linked in the graph</li>
          <li className="st mv-fetch" data-at="6400">Fetched from the shelf</li>
        </ul>
      </div>
      <div className="mv-arrows">
        <Arrow at={3100} label="shelve" />
        <Arrow at={6800} back label="fetch" />
      </div>
      <div className="mv-shelf">
        <p className="mv-shelf-h">Your library</p>
        <div className="mv-books" aria-hidden="true">
          {["Home", "Work", "Health", "Trips", "Recipes", "Sara’s birthday"].map((name, index) => (
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
      </div>
    </div>
  );
}

// 5. Two copies of everything: the raw words, kept forever, and the organized
// pages made from them, which a newer AI can make again from the raw words.
function RawDerivedStage() {
  return (
    <div
      className="mv-stage scene mv-rd"
      data-len="12000"
      role="img"
      aria-label="Two files. On the left the raw file, your voice note and its words, kept forever and never edited. An arrow leads to the organized file on the right: pages for Sara's birthday and the dentist, made by today's AI. Later a newer AI reads the same raw file again and makes a better organized version, while the raw file stays as it was."
    >
      <div className="mv-rd-raw st" data-at="200">
        <p className="mv-rd-k">Raw file</p>
        <p className="mv-rd-words">“Sara’s birthday is Saturday. I’ll book dinner for six.”</p>
        <p className="mv-rd-words">“Dentist moved to Thursday at 4.”</p>
        <p className="mv-seal">Kept forever. Never edited.</p>
      </div>
      <div className="mv-rd-mid">
        <Arrow at={1200} label="today’s AI" />
        <Arrow at={5200} label="a newer AI" />
      </div>
      <div className="mv-rd-out">
        <div className="mv-rd-der st" data-at="1800" data-off="5000">
          <p className="mv-rd-k">Organized file · 2026</p>
          <p className="mv-rd-page">Sara’s birthday</p>
          <p className="mv-rd-page">Dentist</p>
        </div>
        <div className="mv-rd-der mv-rd-v2 st" data-at="5800">
          <p className="mv-rd-k">Organized file · made again</p>
          <p className="mv-rd-page">Sara’s birthday</p>
          <p className="mv-rd-page">Friends · gifts</p>
          <p className="mv-rd-page">Health · Thursday 4pm</p>
        </div>
      </div>
    </div>
  );
}

// 6. The library is yours: a voice note goes into Zenod, and Zenod writes it
// into your Google Drive or your GitHub repository.
function YoursStage() {
  return (
    <div
      className="mv-stage scene mv-yours"
      data-len="9000"
      role="img"
      aria-label="A voice note goes into Zenod. From Zenod an arrow leads to your Google Drive folder and another to your GitHub repository, whichever you chose, where your memory is kept as plain Markdown files you own."
    >
      <span className="mv-pkt mv-yours-in st" data-at="200">
        <span className="mv-play" /> Voice note
      </span>
      <Arrow at={800} />
      <span className="mv-yours-z st" data-at="1200">
        <span className="mv-z">Z</span>
        <b>Zenod</b>
      </span>
      <div className="mv-yours-split">
        <Arrow at={2000} />
        <Arrow at={2000} />
      </div>
      <div className="mv-yours-homes">
        <p className="mv-yours-home st" data-at="2600">
          <span className="mv-folder" aria-hidden="true" />
          <b>Your Google Drive</b>
          <small>Birthday dinner.md</small>
        </p>
        <p className="mv-yours-or st" data-at="2900">or</p>
        <p className="mv-yours-home st" data-at="3200">
          <span className="mv-folder" aria-hidden="true" />
          <b>Your GitHub repo</b>
          <small>Birthday dinner.md</small>
        </p>
      </div>
    </div>
  );
}

// The helpers that run on production today (packages/server personaCatalog.ts
// and patterns.ts), drawn as a ring around your memory.
const HELPERS = ["Open loops", "Weekly recap", "Something to try", "Patterns and ideas", "Ideas digest", "Topic gardener"];

const RING = HELPERS.map((name, i) => {
  const a = ((-90 + 60 * i) * Math.PI) / 180;
  return { name, x: 220 + 150 * Math.cos(a), y: 150 + 108 * Math.sin(a), w: name.length * 9.2 + 26 };
});

function HelperRing() {
  return (
    <svg className="mv-ring" viewBox="0 0 440 300" aria-hidden="true">
      {RING.map((n) => (
        <line key={`l-${n.name}`} x1="220" y1="150" x2={n.x} y2={n.y} className="mv-ring-spoke" />
      ))}
      <circle cx="220" cy="150" r="56" className="mv-ring-core" />
      <text x="220" y="145" className="mv-ring-core-t">Your</text>
      <text x="220" y="168" className="mv-ring-core-t">memory</text>
      {RING.map((n) => (
        <g key={n.name} className={n.name === "Ideas digest" ? "mv-ring-n on" : "mv-ring-n"}>
          <rect x={n.x - n.w / 2} y={n.y - 17} width={n.w} height="34" rx="17" />
          <text x={n.x} y={n.y + 5.5}>{n.name}</text>
        </g>
      ))}
    </svg>
  );
}

// 7. Agents mine what you already said and bring back a connection.
function HelpersStage() {
  return (
    <div
      className="mv-stage scene mv-helpers"
      data-len="11000"
      role="img"
      aria-label="Six helpers sit around your memory: Open loops, Weekly recap, Something to try, Patterns and ideas, Ideas digest and Topic gardener. The Ideas digest helper reads your last two weeks and finds a connection: the cookbook idea from Tuesday fits Sara's birthday on Saturday. It leaves a suggestion in your inbox, with Do it and Not now."
    >
      <HelperRing />
      <div className="mv-helper st" data-at="200">
        <p className="mv-helper-name">
          <span className="mv-moon" aria-hidden="true" /> Ideas digest
        </p>
        <p className="mv-helper-do" data-type="Reading your last two weeks of notes…" />
        <span className="mv-scan st" data-at="600" data-off="3600" aria-hidden="true" />
      </div>
      <div className="mv-out">
        <div className="mv-card st" data-at="3700">
          <p className="mv-card-from">New connection · Ideas digest</p>
          <b>Your cookbook idea from Tuesday fits Sara’s birthday. Link them?</b>
          <p className="mv-card-act">
            <span className="mv-do">Do it</span>
            <span>Not now</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export const FiveMoves = React.memo(function FiveMoves() {
  const host = MCP_SERVER_URL.replace("https://", "");
  return (
    <section className="mv-sec" id="how" aria-labelledby="moves-title">
      <div className="mv-head" id="how-zenod-works">
        <p className="mv-kicker">How Zenod works</p>
        <h2 id="moves-title">You talk. Your memory organizes itself.</h2>
      </div>

      <Move no="1" id="forever" title="We keep your words forever, exactly as you said them." stage={<KeptStage />}>
        <p>
          Every voice note, photo and message lands in a dated log, word for
          word, in your own Google Drive or GitHub.
        </p>
      </Move>

      <Move no="2" id="cloud" title="From your words, a cloud of thoughts." stage={<CloudStage />}>
        <p>
          Zenod links each thought to the ones it touches. The thicker the line,
          the stronger the link, and answers follow the strong links first.
        </p>
      </Move>

      <Move no="3" id="mcp" title="Connect all your agents to one memory." stage={<HubStage />}>
        <p>
          Claude, ChatGPT, Codex, Gemini CLI, Cursor, VS Code and any MCP tool
          can search it, read it and save to it.
        </p>
        <p className="pp-actions">
          <a className="pp-btn pp-btn-primary" href="/connect">
            Connect your AI tool
          </a>
        </p>
        <p className="pp-fine">
          Over MCP, from the cloud: add {host} once and sign in. Listed in the
          official MCP Registry as Zenod.
        </p>
      </Move>

      <Move no="4" id="librarian" title="Zenod is the librarian. The library stays yours." stage={<LibrarianStage />}>
        <p>
          Zenod files what comes in, keeps the index and fetches what you ask
          for, with its source.
        </p>
      </Move>

      <Move no="5" id="kept" title="Kept exactly as you said it." stage={<RawDerivedStage />}>
        <p>
          We keep two files. The raw one is your words, kept forever. The
          organized one is made from it, so newer, smarter AI can make it again,
          better.
        </p>
      </Move>

      <Move no="6" id="yours" title="The library is yours." stage={<YoursStage />}>
        <p>
          Your memory is plain Markdown in your Google Drive or GitHub. Open it
          in Obsidian as it is. Stop using Zenod and you keep every file.
        </p>
      </Move>

      <Move no="7" id="helpers" title="Send agents to mine your memory." stage={<HelpersStage />}>
        <p>
          Switch on helpers in the app. They read what you already said and
          bring back new connections and ideas, with the notes they came from.
          They change nothing until you press Do it.
        </p>
      </Move>
    </section>
  );
});
