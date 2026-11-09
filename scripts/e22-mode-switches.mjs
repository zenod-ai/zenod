#!/usr/bin/env node
// EPIC-22 E22-L3: tune Zenod's mode pick from the person's switches. Zero model spend: it runs the
// plain rules (ruleSendRoute, no model call) and reads files only.
//
//   count   Count the switches from the proxy's access log (JSON lines on stdin): each switch is one
//           POST /api/console/memory-switch answered 202. Needs no access to the person's data.
//             sudo -n cat /etc/dokploy/traefik/dynamic/access.log | node scripts/e22-mode-switches.mjs count
//   tune    Read the switches the app recorded (mode-switches.jsonl in the tenant's data folder),
//           show which picks he changes and to what, replay today's rules on each one, write them
//           as labelled examples, and check the rules still hold on the fixed sets:
//             node scripts/e22-mode-switches.mjs tune --switches mode-switches.jsonl \
//               --core packages/core --set set.jsonl --heldout heldout-voice.jsonl [--examples out.jsonl]
//           The fixed sets are private (~/zenod-eval/e22-modes on VPS3); messages print only to this
//           terminal and the examples file, never to the repo. Exit 1 when a guard fails.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Below this many switches a pattern is noise, so the report stops at the count. */
export const MIN_SWITCHES = 15;
/** The L2 floors on the fixed sets: the tuned rules may not fall below them. */
export const GUARDS = { set: 71, both: 128 };

/** The Send actions that honour a switch to each mode. */
export const ACCEPTS = {
  keep: ["keep"],
  lookup: ["answer"],
  talk: ["talk"],
  job: ["job", "unsure"],
};

const SPOKEN_TAG = /\b(you know|right|no|okay|ok|yeah)\s*\?/i;

export function readJsonl(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** Switches in the proxy's access log: POST /api/console/memory-switch answered 202. */
export function countFromAccessLog(lines, since = "") {
  let switches = 0;
  for (const row of lines) {
    if (row.RequestMethod !== "POST" || row.DownstreamStatus !== 202) continue;
    if (String(row.RequestPath ?? "").split("?")[0] !== "/api/console/memory-switch") continue;
    if (since && String(row.StartUTC ?? "") < since) continue;
    switches += 1;
  }
  return switches;
}

/** What a message looks like, so switches can be grouped by the shape the rules see. */
export function shape(message) {
  const text = message.trim();
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
  return {
    opener: words.slice(0, 2).join(" "),
    endsOnQuestion: /\?\s*$/.test(text),
    spokenTag: SPOKEN_TAG.test(text),
    length: text.length < 80 ? "short" : text.length < 400 ? "medium" : "long",
  };
}

/** Score a labelled set (rows of {message, expect}) with a route function. */
export function score(rows, route) {
  let right = 0;
  const wrong = [];
  for (const row of rows) {
    const action = route(row.message).action;
    if (row.expect.includes(action)) right += 1;
    else wrong.push({ id: row.id, want: row.expect, got: action });
  }
  return { right, of: rows.length, wrong };
}

/** The tuning report: which picks he changes, to what, and which today's rules still get wrong. */
export function analyse(switches, route) {
  const matrix = {};
  const by = {};
  const stillWrong = [];
  const patterns = {};
  for (const sw of switches) {
    const key = `${sw.from} -> ${sw.to}`;
    matrix[key] = (matrix[key] ?? 0) + 1;
    by[sw.by] = (by[sw.by] ?? 0) + 1;
    const now = route(sw.message).action;
    if ((ACCEPTS[sw.to] ?? []).includes(now)) continue;
    stillWrong.push({ at: sw.at, from: sw.from, to: sw.to, now, shape: shape(sw.message), message: sw.message });
    const s = shape(sw.message);
    for (const [name, value] of Object.entries({ opener: s.opener, endsOnQuestion: s.endsOnQuestion, spokenTag: s.spokenTag, length: s.length })) {
      const k = `${sw.to} · ${name}=${value}`;
      patterns[k] = (patterns[k] ?? 0) + 1;
    }
  }
  const top = Object.entries(patterns)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  return { switches: switches.length, matrix, by, stillWrong, patterns: Object.fromEntries(top) };
}

/** Each switch as a labelled example for the fixed set: the mode he switched to is the right one. */
export function examples(switches) {
  return switches.map((sw, i) => ({ id: `switch-${i}`, source: "mode switch", message: sw.message, expect: ACCEPTS[sw.to] }));
}

function arg(argv, name) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(argv) {
  const [command] = argv;
  if (command === "count") {
    const switches = countFromAccessLog(readJsonl(readFileSync(0, "utf8")), arg(argv, "since") ?? "");
    console.log(JSON.stringify({ switches, enough: switches >= MIN_SWITCHES, min: MIN_SWITCHES }));
    return 0;
  }
  if (command !== "tune") {
    console.error("usage: e22-mode-switches.mjs count [--since ISO] < access.log | tune --switches F --core DIR --set F --heldout F [--examples OUT]");
    return 2;
  }
  const core = resolve(arg(argv, "core") ?? "packages/core");
  const { ruleSendRoute } = await import(pathToFileURL(`${core}/dist/llm/sendRoute.js`).href);
  const switches = readJsonl(readFileSync(arg(argv, "switches"), "utf8"));
  const report = { min: MIN_SWITCHES, enough: switches.length >= MIN_SWITCHES };
  if (report.enough) Object.assign(report, analyse(switches, ruleSendRoute));
  else report.switches = switches.length;
  const out = arg(argv, "examples");
  if (out) writeFileSync(out, examples(switches).map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
  const set = score(readJsonl(readFileSync(arg(argv, "set"), "utf8")), ruleSendRoute);
  const heldout = score(readJsonl(readFileSync(arg(argv, "heldout"), "utf8")), ruleSendRoute);
  report.guards = {
    set: { right: set.right, of: set.of, floor: GUARDS.set, ok: set.right >= GUARDS.set },
    both: { right: set.right + heldout.right, of: set.of + heldout.of, floor: GUARDS.both, ok: set.right + heldout.right >= GUARDS.both },
    setWrong: set.wrong,
  };
  console.log(JSON.stringify(report, null, 1));
  return report.guards.set.ok && report.guards.both.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
