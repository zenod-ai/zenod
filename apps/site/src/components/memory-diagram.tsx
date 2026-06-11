import { FolderIcon, LandmarkIcon, LockIcon } from "lucide-react"

const agents = ["Claude", "Codex", "Hermes", "Your laptop"]

const silos = [
  {
    icon: LockIcon,
    title: "Claude's memory of you",
    note: "locked in their cloud — can't open it, can't export it",
  },
  {
    icon: LockIcon,
    title: "Codex's memory of you",
    note: "a different story — and it never talks to the others",
  },
  {
    icon: LockIcon,
    title: "Hermes' memory of you",
    note: "a third version, drifting further out of sync",
  },
  {
    icon: FolderIcon,
    title: "Loose files",
    note: "notes and documents with no librarian at all",
  },
]

const doors = [
  { name: "Claude", via: "via MCP", line: "“what did we decide on the flat hunt?”" },
  { name: "Codex", via: "via MCP", line: "“store this migration decision.”" },
  { name: "Hermes", via: "via MCP", line: "“pull the notes from last week's call.”" },
  { name: "Your laptop", via: "direct", line: "open the vault in Obsidian — it's just markdown." },
]

/* Four parallel dead-end lines — every agent feeds its own silo. Static on purpose. */
function DeadEndLines() {
  return (
    <svg viewBox="0 0 800 44" preserveAspectRatio="none" aria-hidden className="h-11 w-full">
      <path d="M100 0 L100 44" className="dead-line" />
      <path d="M300 0 L300 44" className="dead-line" />
      <path d="M500 0 L500 44" className="dead-line" />
      <path d="M700 0 L700 44" className="dead-line" />
    </svg>
  )
}

/* Four paths converging from the door columns into the Zenod node. */
function ConvergingLines() {
  return (
    <svg
      viewBox="0 0 800 72"
      preserveAspectRatio="none"
      aria-hidden
      className="h-16 w-full"
    >
      <path d="M100 0 C 100 48, 400 28, 400 72" className="flow-line" />
      <path d="M300 0 C 300 52, 400 36, 400 72" className="flow-line" />
      <path d="M500 0 C 500 52, 400 36, 400 72" className="flow-line" />
      <path d="M700 0 C 700 48, 400 28, 400 72" className="flow-line" />
    </svg>
  )
}

function VerticalLine() {
  return (
    <svg viewBox="0 0 800 40" preserveAspectRatio="none" aria-hidden className="h-10 w-full">
      <path d="M400 0 L400 40" className="flow-line" />
    </svg>
  )
}

export function MemoryDiagram() {
  return (
    <div>
      {/* ── before ── */}
      <p className="label-caps text-muted-foreground">Without Zenod</p>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {agents.map((name) => (
          <div key={name} className="border border-dashed border-border p-4 opacity-80">
            <p className="label-caps text-muted-foreground">{name}</p>
          </div>
        ))}
      </div>
      <DeadEndLines />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {silos.map(({ icon: Icon, title, note }) => (
          <div
            key={title}
            className="border border-dashed border-border bg-muted/40 p-4 opacity-80"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon className="size-3 shrink-0" /> {title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/70">
              {note}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Four agents, four contradictory memories of you — each one partial,
        none of them shared.{" "}
        <span className="text-foreground">
          And none of them yours: you can't open them, diff them, or take them
          with you.
        </span>{" "}
        Your own context, locked in somebody else's database.
      </p>

      {/* ── after ── */}
      <p className="label-caps mt-14 text-rust">With Zenod</p>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {doors.map((d) => (
          <div key={d.name} className="border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="label-caps">{d.name}</p>
              <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground/70 uppercase">
                {d.via}
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground italic">
              {d.line}
            </p>
          </div>
        ))}
      </div>

      <ConvergingLines />

      <div className="mx-auto max-w-md border-2 border-rust bg-card p-5 text-center">
        <p className="font-display text-2xl font-bold tracking-tight">ZENOD</p>
        <p className="label-caps mt-1 text-rust">Your librarian</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          One enforced write path. Files the evidence, updates the meaning,
          answers with sources — asks when unsure.
        </p>
      </div>

      <VerticalLine />

      <div className="mx-auto max-w-md border border-border bg-card p-5 text-center">
        <p className="flex items-center justify-center gap-2">
          <LandmarkIcon className="size-4 text-rust" strokeWidth={1.5} />
          <span className="font-display text-xl font-semibold">
            Your one Obsidian vault
          </span>
        </p>
        <p className="label-caps mt-2 text-muted-foreground">
          markdown · git · your GitHub account
        </p>
      </div>

      <p className="label-caps mt-6 text-center text-rust">
        You own this layer.
      </p>
      <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
        Every agent reads and writes the same brain — and the brain is plain
        markdown in your GitHub account. Open it in Obsidian, diff it, walk
        away with it.
      </p>
    </div>
  )
}
