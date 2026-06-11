import { DatabaseIcon, LandmarkIcon } from "lucide-react"

const silos = [
  { name: "Claude", note: "its own memory" },
  { name: "Codex", note: "another memory" },
  { name: "Hermes", note: "a third memory" },
  { name: "Your laptop", note: "scattered files" },
]

const doors = [
  { name: "Claude", via: "via MCP", line: "“what did we decide on the flat hunt?”" },
  { name: "Codex", via: "via MCP", line: "“store this migration decision.”" },
  { name: "Hermes", via: "via MCP", line: "“pull the notes from last week's call.”" },
  { name: "Your laptop", via: "direct", line: "open the vault in Obsidian — it's just markdown." },
]

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
        {silos.map((s) => (
          <div key={s.name} className="border border-dashed border-border p-4 opacity-80">
            <p className="label-caps text-muted-foreground">{s.name}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <DatabaseIcon className="size-3 shrink-0" /> {s.note}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Four agents, four memories — each remembering a different you, none of
        them complete, none of them yours. Fragments rot in silos you can't
        open, diff, or take with you.
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
          <span className="font-display text-xl font-semibold">Your vault</span>
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
