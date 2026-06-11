const readers = ["Claude", "Codex", "Hermes", "You", "Whatever ships next"]

const layers = [
  {
    name: "Layer one · the knowledge",
    note: "ideas, areas, lines of thinking — emerging from connected dots",
    dashed: false,
  },
  {
    name: "Layer zero · the evidence",
    note: "immutable facts and receipts, date-stamped, never edited",
    dashed: true,
  },
  {
    name: "The Pinax · the catalog",
    note: "the index every agent scans first — named for Callimachus' catalog of Alexandria",
    dashed: false,
  },
]

function ReadLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className={className ?? "h-full w-full"}
    >
      <path d="M50 0 L50 100" className="read-line" />
    </svg>
  )
}

function WriteLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden
      className={`w-full ${className ?? "h-8"}`}
    >
      <path d="M50 0 L50 32" className="flow-line" />
    </svg>
  )
}

export function BetDiagram() {
  return (
    <div className="mx-auto max-w-4xl">
      {/* every reader and writer */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {readers.map((r) => (
          <span key={r} className="label-caps border border-border bg-card px-3 py-2">
            {r}
          </span>
        ))}
      </div>

      {/* two channels */}
      <div className="mx-auto grid max-w-2xl grid-cols-2 gap-8">
        <div className="flex flex-col items-center">
          <p className="label-caps pt-3 pb-1 text-muted-foreground">Read · open</p>
          <p className="min-h-9 px-2 text-center text-[0.68rem] leading-snug text-muted-foreground/80">
            anyone you allow, straight from GitHub — Zenod not required
          </p>
          <ReadLine className="h-[138px] w-full" />
        </div>
        <div className="flex flex-col items-center">
          <p className="label-caps pt-3 pb-1 text-rust">Write · one door</p>
          <p className="min-h-9 px-2 text-center text-[0.68rem] leading-snug text-muted-foreground/80">
            every memory goes through the librarian
          </p>
          <WriteLine className="h-10 w-full" />
          <div className="shrink-0 border-2 border-rust bg-card px-4 py-1.5 text-center">
            <p className="font-display text-base font-bold tracking-tight">ZENOD</p>
            <p className="font-mono text-[0.55rem] tracking-widest text-rust uppercase">
              the librarian
            </p>
          </div>
          <WriteLine className="h-10 w-full" />
        </div>
      </div>

      {/* the library */}
      <div className="border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl font-semibold">The library</h3>
          <p className="label-caps text-muted-foreground">
            a private repo · your GitHub account
          </p>
        </div>
        <div className="mt-5 space-y-2">
          {layers.map((l) => (
            <div
              key={l.name}
              className={`flex flex-col gap-1 border px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
                l.dashed ? "border-dashed border-border bg-muted/40" : "border-border bg-background"
              }`}
            >
              <p className="label-caps shrink-0 text-foreground">{l.name}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{l.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
