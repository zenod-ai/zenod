// E26-S35 (Jordi, 2026-11-08: "this graph functionality is incredibly cool ... it should be part
// of the landing page"): a public, read-only sample memory on zenod.dev/testers. One normal
// person's week (Sara, the example zenod.dev uses since E25-S3): four voice notes, the thoughts
// Zenod links from them, and how strong each link is. Static demo data only: no account, no
// fetch, nothing personal.
// E26-S38: two more invented weeks beside Sara's (a parent's, a freelancer's), so a visitor sees
// someone like themselves. Same shape, same component; nobody here is a real person.

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

export type SampleWeek = {
  id: string;
  /** The first name the switch and the notes use. */
  name: string;
  /** One or two words on who they are, shown on the switch. */
  who: string;
  notes: SampleNote[];
  thoughts: SampleThought[];
  links: SampleLink[];
  /** The thought open when the week is shown. */
  start: string;
};

// Every week is laid out in a 600 x 400 box.
const SARA: SampleWeek = {
  id: "sara",
  name: "Sara",
  who: "office job",
  notes: [
    { id: "n1", when: "Monday 08:42", length: "0:11", words: "Sara’s birthday is Saturday. Book dinner for six at the Italian place." },
    { id: "n2", when: "Tuesday 13:05", length: "0:09", words: "Dentist moved to Thursday at 4, so I’ll leave the team meeting early. Saturday is still free." },
    { id: "n3", when: "Wednesday 19:20", length: "0:14", words: "Got two concert tickets for Sara, that’s her present. Ask Ana to bring the cake." },
    { id: "n4", when: "Thursday 09:30", length: "0:08", words: "Team meeting: the launch moves to next month. Send the notes before Friday." },
  ],
  // The birthday in the middle like the landing's cloud.
  thoughts: [
    { id: "bday", label: "Sara’s birthday", x: 300, y: 165, topic: true, side: "bottom", notes: ["n1", "n3"] },
    { id: "dinner", label: "Dinner for six", x: 100, y: 60, side: "top", notes: ["n1"] },
    { id: "tickets", label: "Concert tickets", x: 495, y: 55, side: "top", notes: ["n3"] },
    { id: "cake", label: "Cake from Ana", x: 515, y: 170, side: "bottom", notes: ["n3"] },
    { id: "saturday", label: "Saturday", x: 85, y: 180, side: "bottom", notes: ["n1", "n2"] },
    { id: "dentist", label: "Dentist, Thursday", x: 215, y: 340, side: "bottom", notes: ["n2"] },
    { id: "meeting", label: "Team meeting", x: 470, y: 335, topic: true, side: "bottom", notes: ["n2", "n4"] },
  ],
  links: [
    { a: "bday", b: "tickets", strength: 0.95, label: true },
    { a: "bday", b: "dinner", strength: 0.9 },
    { a: "bday", b: "saturday", strength: 0.9 },
    { a: "dinner", b: "saturday", strength: 0.8 },
    { a: "bday", b: "cake", strength: 0.75 },
    { a: "tickets", b: "cake", strength: 0.45 },
    { a: "dentist", b: "meeting", strength: 0.8 },
    { a: "saturday", b: "dentist", strength: 0.3, label: true },
  ],
  start: "bday",
};

// A parent juggling a family week.
const DAN: SampleWeek = {
  id: "dan",
  name: "Dan",
  who: "parent",
  notes: [
    { id: "n1", when: "Monday 07:50", length: "0:12", words: "Okay so Leo has swimming on Wednesday and I still can’t find his goggles. And Mia’s school trip form is due Friday, I keep forgetting to sign it." },
    { id: "n2", when: "Tuesday 18:10", length: "0:10", words: "Called the plumber, he can come Thursday morning, so I’ll work from home that day. Mum is doing the school pickup on Wednesday." },
    { id: "n3", when: "Wednesday 21:15", length: "0:15", words: "Mia wants a dinosaur party, so Sunday the 14th it is. Ask Sam’s mum about the bouncy castle. I need to get balloons and a cake." },
    { id: "n4", when: "Thursday 12:40", length: "0:09", words: "Plumber’s been, the tap is fixed. Sign Mia’s form tonight and put the money in the envelope." },
  ],
  thoughts: [
    { id: "trip", label: "School trip form", x: 300, y: 165, topic: true, side: "bottom", notes: ["n1", "n4"] },
    { id: "swim", label: "Leo’s swimming", x: 100, y: 60, side: "top", notes: ["n1"] },
    { id: "mum", label: "Mum picks up", x: 95, y: 255, side: "top", notes: ["n2"] },
    { id: "plumber", label: "Plumber, Thursday", x: 190, y: 335, topic: true, side: "bottom", notes: ["n2", "n4"] },
    { id: "party", label: "Dinosaur party", x: 470, y: 60, side: "top", notes: ["n3"] },
    { id: "castle", label: "Bouncy castle", x: 520, y: 185, side: "bottom", notes: ["n3"] },
    { id: "cake", label: "Balloons, cake", x: 400, y: 320, side: "bottom", notes: ["n3"] },
  ],
  links: [
    { a: "trip", b: "swim", strength: 0.85, label: true },
    { a: "trip", b: "plumber", strength: 0.6 },
    { a: "plumber", b: "mum", strength: 0.8 },
    { a: "party", b: "castle", strength: 0.9 },
    { a: "party", b: "cake", strength: 0.85 },
    { a: "castle", b: "cake", strength: 0.5 },
    { a: "trip", b: "party", strength: 0.3, label: true },
  ],
  start: "trip",
};

// A freelancer with ideas for clients.
const PRIYA: SampleWeek = {
  id: "priya",
  name: "Priya",
  who: "freelancer",
  notes: [
    { id: "n1", when: "Monday 09:05", length: "0:13", words: "Harbor Coffee wants the new menu by the twentieth. Idea: do it all on one page with little hand-drawn icons, not a whole booklet like last time." },
    { id: "n2", when: "Tuesday 16:30", length: "0:11", words: "The bakery still hasn’t paid for the logo, it’s been three weeks. I’ll send a friendly nudge on Friday." },
    { id: "n3", when: "Wednesday 11:50", length: "0:16", words: "Thought of this in the shower. A little stamp card for the bakery, and the coffee place could use one too. I’ll quote it as an extra." },
    { id: "n4", when: "Thursday 20:10", length: "0:10", words: "Noor has space in January to build my portfolio site. I should write up the three case studies before then." },
  ],
  thoughts: [
    { id: "harbor", label: "Harbor Coffee", x: 120, y: 175, topic: true, side: "bottom", notes: ["n1", "n3"] },
    { id: "onepage", label: "One-page menu", x: 100, y: 60, side: "top", notes: ["n1"] },
    { id: "stamp", label: "Stamp card idea", x: 300, y: 130, side: "top", notes: ["n3"] },
    { id: "bakery", label: "The bakery", x: 495, y: 175, topic: true, side: "bottom", notes: ["n2", "n3"] },
    { id: "nudge", label: "Friday nudge", x: 495, y: 55, side: "top", notes: ["n2"] },
    { id: "portfolio", label: "Portfolio site", x: 215, y: 340, side: "bottom", notes: ["n4"] },
    { id: "cases", label: "Case studies", x: 470, y: 335, side: "bottom", notes: ["n4"] },
  ],
  links: [
    { a: "harbor", b: "onepage", strength: 0.9 },
    { a: "harbor", b: "stamp", strength: 0.8 },
    { a: "bakery", b: "stamp", strength: 0.9, label: true },
    { a: "bakery", b: "nudge", strength: 0.8 },
    { a: "harbor", b: "bakery", strength: 0.4 },
    { a: "portfolio", b: "cases", strength: 0.9 },
    { a: "bakery", b: "cases", strength: 0.3, label: true },
  ],
  start: "stamp",
};

export const SAMPLE_WEEKS: SampleWeek[] = [SARA, DAN, PRIYA];

/** The week shown first: Sara's, the one Jordi approved. */
export const SAMPLE_FIRST_WEEK = SARA.id;

export function sampleWeek(id: string): SampleWeek {
  const found = SAMPLE_WEEKS.find((week) => week.id === id);
  if (!found) throw new Error(`no sample week ${id}`);
  return found;
}

/** The app's strength look (apps/web lib/memory-graph.ts strengthLook): thicker and greener when stronger. */
export function sampleStrengthLook(strength: number): { width: number; opacity: number; weak: boolean } {
  const s = Math.max(0, Math.min(1, strength));
  return {
    width: Math.round((0.8 + 3.4 * s) * 100) / 100,
    opacity: Math.round((0.45 + 0.55 * s) * 100) / 100,
    weak: s < 0.4,
  };
}

export function sampleThought(week: SampleWeek, id: string): SampleThought {
  const found = week.thoughts.find((thought) => thought.id === id);
  if (!found) throw new Error(`no sample thought ${id} in ${week.id}`);
  return found;
}

/** The voice notes a thought came from, in the order they were sent. */
export function notesFor(week: SampleWeek, id: string): SampleNote[] {
  const wanted = new Set(sampleThought(week, id).notes);
  return week.notes.filter((note) => wanted.has(note.id));
}

/** A thought's neighbours, strongest link first. */
export function linksOf(week: SampleWeek, id: string): Array<{ thought: SampleThought; strength: number }> {
  return week.links
    .filter((link) => link.a === id || link.b === id)
    .map((link) => ({ thought: sampleThought(week, link.a === id ? link.b : link.a), strength: link.strength }))
    .sort((x, y) => y.strength - x.strength);
}
