// E26-S35: the public sample memory above the testers' apply form. Sara's week drawn as the
// app's cloud of thoughts (the landing's look, the app's strength lines); tap a thought and the
// voice notes it came from show beside it. Read only, static demo data, no sign-in.
import * as React from "react";

import {
  linksOf,
  notesFor,
  SAMPLE_LINKS,
  SAMPLE_START,
  SAMPLE_THOUGHTS,
  sampleStrengthLook,
  sampleThought,
} from "@/lib/sample-memory";

function SampleGraph({ open, onOpen }: { open: string; onOpen: (id: string) => void }) {
  const near = new Set(linksOf(open).map((link) => link.thought.id));
  return (
    <svg viewBox="0 0 600 400" className="sm-svg" role="group" aria-label="Sara’s week as a cloud of linked thoughts">
      {SAMPLE_LINKS.map((link) => {
        const a = sampleThought(link.a);
        const b = sampleThought(link.b);
        const look = sampleStrengthLook(link.strength);
        const lit = link.a === open || link.b === open;
        return (
          <g key={`${link.a}-${link.b}`}>
            <line
              className={["sm-l", look.weak ? "sm-l-weak" : "", lit ? "sm-l-lit" : ""].join(" ")}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              style={{ strokeWidth: look.width * 1.6, opacity: lit ? 1 : look.opacity * 0.6 }}
            />
            {link.label ? (
              <text className="sm-w" x={(a.x + b.x) / 2 + 10} y={(a.y + b.y) / 2 - 8}>
                {link.strength}
              </text>
            ) : null}
          </g>
        );
      })}
      {SAMPLE_THOUGHTS.map((thought) => {
        const isOpen = thought.id === open;
        const r = thought.topic ? 13 : 9;
        return (
          <g
            key={thought.id}
            className={["sm-n", thought.topic ? "sm-n-topic" : "", isOpen ? "sm-n-open" : "", near.has(thought.id) ? "sm-n-near" : ""].join(" ")}
            role="button"
            tabIndex={0}
            aria-pressed={isOpen}
            aria-label={`${thought.label}: show the voice notes it came from`}
            onClick={() => onOpen(thought.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(thought.id);
              }
            }}
          >
            <circle className="sm-hit" cx={thought.x} cy={thought.y} r={40} />
            <circle cx={thought.x} cy={thought.y} r={r} />
            <text x={thought.x} y={thought.side === "top" ? thought.y - r - 12 : thought.y + r + 28} textAnchor="middle">
              {thought.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SampleNotes({ open, onOpen }: { open: string; onOpen: (id: string) => void }) {
  const thought = sampleThought(open);
  const notes = notesFor(open);
  return (
    <div className="sm-panel" aria-live="polite">
      <p className="sm-panel-h">{thought.label}</p>
      <p className="sm-from">
        From {notes.length === 1 ? "Sara’s voice note" : `${notes.length} of Sara’s voice notes`}, word for word:
      </p>
      {notes.map((note) => (
        <blockquote key={note.id} className="sm-note">
          <small>
            <span className="sm-play" aria-hidden="true" />
            {note.when} · WhatsApp voice note {note.length}
          </small>
          “{note.words}”
        </blockquote>
      ))}
      <p className="sm-links">
        <span>Linked to</span>
        {linksOf(open).map((link) => (
          <button key={link.thought.id} type="button" className="sm-chip" onClick={() => onOpen(link.thought.id)}>
            {link.thought.label} <b>{link.strength}</b>
          </button>
        ))}
      </p>
    </div>
  );
}

// E26-S37: the same component sits on /testers (the way on is the apply form below it) and on the
// zenod.dev home page (the way on is /testers). Only the closing link differs.
export function SampleMemory({
  wayOn = { href: "#apply", label: "Apply to test it with your voice notes" },
}: {
  wayOn?: { href: string; label: string };
}) {
  const [open, setOpen] = React.useState(SAMPLE_START);
  return (
    <section className="pp-sample" aria-labelledby="sample-title" data-testid="sample-memory">
      <p className="mv-kicker">Try it, no sign-in</p>
      <h2 id="sample-title">Sara’s week, as Zenod keeps it.</h2>
      <p className="pp-sample-lead">
        Four voice notes Sara sent on WhatsApp, linked the way Zenod links
        yours. The thicker the line, the stronger the link. Tap a thought to
        see the note it came from.
      </p>
      <div className="sm-stage">
        <SampleGraph open={open} onOpen={setOpen} />
        <SampleNotes open={open} onOpen={setOpen} />
      </div>
      <p className="pp-fine sm-fine">
        A sample with demo content. Your own memory is private to you and kept
        in your Google Drive or GitHub.{" "}
        <a href={wayOn.href}>{wayOn.label}</a>
      </p>
    </section>
  );
}
