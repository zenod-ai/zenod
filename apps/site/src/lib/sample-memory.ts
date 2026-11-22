// E26-S35 (Jordi, 2026-11-08: "this graph functionality is incredibly cool ... it should be part
// of the landing page"): a public, read-only sample memory on zenod.dev/testers. One normal
// person's week (Sara, the example zenod.dev uses since E25-S3): four voice notes, the thoughts
// Zenod links from them, and how strong each link is. Static demo data only: no account, no
// fetch, nothing personal.

export type SampleNote = {
  id: string;
  when: string;
  length: string;
  words: string;
};

export type SampleThought = {
  id: string;
  label: string;
  x: number;
  y: number;
  /** A thought several notes meet on: drawn larger, like the app's topics. */
  topic?: boolean;
  /** Where the label sits from the dot. */
  side: "top" | "bottom";
  notes: string[];
};

export type SampleLink = { a: string; b: string; strength: number; label?: boolean };

export const SAMPLE_NOTES: SampleNote[] = [
  { id: "n1", when: "Monday 08:42", length: "0:11", words: "Sara’s birthday is Saturday. Book dinner for six at the Italian place." },
  { id: "n2", when: "Tuesday 13:05", length: "0:09", words: "Dentist moved to Thursday at 4, so I’ll leave the team meeting early. Saturday is still free." },
  { id: "n3", when: "Wednesday 19:20", length: "0:14", words: "Got two concert tickets for Sara, that’s her present. Ask Ana to bring the cake." },
  { id: "n4", when: "Thursday 09:30", length: "0:08", words: "Team meeting: the launch moves to next month. Send the notes before Friday." },
];

// Laid out in a 600 x 420 box, the birthday in the middle like the landing's cloud.
export const SAMPLE_THOUGHTS: SampleThought[] = [
  { id: "bday", label: "Sara’s birthday", x: 300, y: 165, topic: true, side: "bottom", notes: ["n1", "n3"] },
  { id: "dinner", label: "Dinner for six", x: 100, y: 60, side: "top", notes: ["n1"] },
  { id: "tickets", label: "Concert tickets", x: 495, y: 55, side: "top", notes: ["n3"] },
  { id: "cake", label: "Cake from Ana", x: 515, y: 170, side: "bottom", notes: ["n3"] },
  { id: "saturday", label: "Saturday", x: 85, y: 180, side: "bottom", notes: ["n1", "n2"] },
  { id: "dentist", label: "Dentist, Thursday", x: 215, y: 340, side: "bottom", notes: ["n2"] },
  { id: "meeting", label: "Team meeting", x: 470, y: 335, topic: true, side: "bottom", notes: ["n2", "n4"] },
];

export const SAMPLE_LINKS: SampleLink[] = [
  { a: "bday", b: "tickets", strength: 0.95, label: true },
  { a: "bday", b: "dinner", strength: 0.9 },
  { a: "bday", b: "saturday", strength: 0.9 },
  { a: "dinner", b: "saturday", strength: 0.8 },
  { a: "bday", b: "cake", strength: 0.75 },
  { a: "tickets", b: "cake", strength: 0.45 },
  { a: "dentist", b: "meeting", strength: 0.8 },
  { a: "saturday", b: "dentist", strength: 0.3, label: true },
];

export const SAMPLE_START = "bday";

/** The app's strength look (apps/web lib/memory-graph.ts strengthLook): thicker and greener when stronger. */
export function sampleStrengthLook(strength: number): { width: number; opacity: number; weak: boolean } {
  const s = Math.max(0, Math.min(1, strength));
  return {
    width: Math.round((0.8 + 3.4 * s) * 100) / 100,
    opacity: Math.round((0.45 + 0.55 * s) * 100) / 100,
    weak: s < 0.4,
  };
}

export function sampleThought(id: string): SampleThought {
  const found = SAMPLE_THOUGHTS.find((thought) => thought.id === id);
  if (!found) throw new Error(`no sample thought ${id}`);
  return found;
}

/** The voice notes a thought came from, in the order they were sent. */
export function notesFor(id: string): SampleNote[] {
  const wanted = new Set(sampleThought(id).notes);
  return SAMPLE_NOTES.filter((note) => wanted.has(note.id));
}

/** A thought's neighbours, strongest link first. */
export function linksOf(id: string): Array<{ thought: SampleThought; strength: number }> {
  return SAMPLE_LINKS.filter((link) => link.a === id || link.b === id)
    .map((link) => ({ thought: sampleThought(link.a === id ? link.b : link.a), strength: link.strength }))
    .sort((x, y) => y.strength - x.strength);
}
