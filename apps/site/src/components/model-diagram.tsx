import {
  FileTextIcon,
  MessageCircleIcon,
  MicIcon,
  RefreshCwIcon,
} from "lucide-react"

const captures = [
  { icon: MicIcon, label: "a voice note" },
  { icon: FileTextIcon, label: "a document" },
  { icon: MessageCircleIcon, label: "a half-formed thought" },
]

/* Three capture columns converging into the librarian. */
function ConvergeThree() {
  return (
    <svg viewBox="0 0 800 56" preserveAspectRatio="none" aria-hidden className="h-12 w-full">
      <path d="M133 0 C 133 38, 400 22, 400 56" className="flow-line" />
      <path d="M400 0 L 400 56" className="flow-line" />
      <path d="M667 0 C 667 38, 400 22, 400 56" className="flow-line" />
    </svg>
  )
}

/* The librarian fanning out into the two knowledge tiers. */
function DivergeTwo() {
  return (
    <svg viewBox="0 0 800 56" preserveAspectRatio="none" aria-hidden className="h-12 w-full">
      <path d="M400 0 C 400 34, 200 22, 200 56" className="flow-line" />
      <path d="M400 0 C 400 34, 600 22, 600 56" className="flow-line" />
    </svg>
  )
}

/* Both tiers feeding every answer. */
function ConvergeTwo() {
  return (
    <svg viewBox="0 0 800 56" preserveAspectRatio="none" aria-hidden className="h-12 w-full">
      <path d="M200 0 C 200 34, 400 22, 400 56" className="flow-line" />
      <path d="M600 0 C 600 34, 400 22, 400 56" className="flow-line" />
    </svg>
  )
}

export function ModelDiagram() {
  return (
    <div className="mx-auto max-w-4xl">
      {/* capture */}
      <div className="grid grid-cols-3 gap-4">
        {captures.map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex items-center justify-center gap-2 border border-dashed border-border p-3 text-center"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
          </div>
        ))}
      </div>

      <ConvergeThree />

      {/* the librarian */}
      <div className="mx-auto max-w-md border-2 border-rust bg-card p-5 text-center">
        <p className="label-caps text-rust">Role one</p>
        <p className="font-display mt-1 text-2xl font-semibold">The librarian</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Runs on every message — files it the moment it arrives, before it
          rots in an inbox. Asks instead of guessing.
        </p>
      </div>

      <DivergeTwo />

      {/* the two tiers */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border border-border bg-card p-6">
          <p className="label-caps text-muted-foreground">Tier one</p>
          <h3 className="font-display mt-2 text-xl font-semibold">The evidence</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The verbatim artifact: what was said, the voice note, the document.
            Date-stamped, filed, immutable — append-only, never edited.{" "}
            <span className="text-foreground">A receipt.</span>
          </p>
        </div>
        <div className="border border-border bg-card p-6">
          <p className="label-caps text-muted-foreground">Tier two</p>
          <h3 className="font-display mt-2 text-xl font-semibold">The meaning</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            What the evidence tells us, distilled into living, linked pages —
            projects, life areas, lines of thinking.{" "}
            <span className="text-foreground">
              Every claim cites its receipt:
            </span>{" "}
            <em>"leaning toward the south-facing flat (see voice note, June 3)."</em>
          </p>
        </div>
      </div>

      {/* the compactor tends the meaning layer */}
      <div className="mt-4 flex items-start gap-3 border border-dashed border-border p-4 sm:items-center">
        <RefreshCwIcon className="size-4 shrink-0 text-rust" strokeWidth={1.5} />
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
          <span className="label-caps text-foreground">Role two · the compactor</span>{" "}
          — runs periodically over the meaning layer: merges duplicates,
          connects pages that should know about each other, tightens bloat.
          Adds no information.
        </p>
      </div>

      <ConvergeTwo />

      {/* ask */}
      <div className="mx-auto max-w-md border border-border bg-card p-5 text-center">
        <p className="label-caps text-rust">Then ask anything</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Zenod reads both tiers: the answer comes from the meaning,
          cited back to the evidence — for you and every agent you use.
        </p>
      </div>
    </div>
  )
}
