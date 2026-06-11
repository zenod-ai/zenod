import type { ReactNode } from "react"
import { FileTextIcon, RefreshCwIcon } from "lucide-react"

function FlowDown({ className = "h-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden
      className={`w-full ${className}`}
    >
      <path d="M50 0 L50 32" className="flow-line" />
    </svg>
  )
}

/* Two tiers converging into one answer. */
function FlowMerge() {
  return (
    <svg viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden className="h-9 w-full">
      <path d="M75 0 C 75 24, 150 16, 150 36" className="flow-line" />
      <path d="M225 0 C 225 24, 150 16, 150 36" className="flow-line" />
    </svg>
  )
}

/* Arcs linking the knowledge pages to each other. */
function KnowledgeArcs() {
  return (
    <svg viewBox="0 0 300 26" preserveAspectRatio="none" aria-hidden className="h-6 w-full">
      <path d="M50 26 C 80 4, 120 4, 150 26" className="flow-line" />
      <path d="M150 26 C 180 4, 220 4, 250 26" className="flow-line" />
      <path d="M50 26 C 110 -6, 190 -6, 250 26" className="flow-line" />
    </svg>
  )
}

function ZenodNode({ sub }: { sub: string }) {
  return (
    <div className="mx-auto w-fit border-2 border-rust bg-card px-5 py-2.5 text-center">
      <p className="font-display text-lg font-bold tracking-tight">ZENOD</p>
      <p className="font-mono text-[0.6rem] tracking-widest text-rust uppercase">{sub}</p>
    </div>
  )
}

function QuoteChip({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-fit max-w-full border border-border bg-card px-4 py-2.5 text-center text-xs text-muted-foreground italic">
      {children}
    </div>
  )
}

function EvidenceFiles({ muted = false }: { muted?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${muted ? "opacity-70" : ""}`}>
      {["voice-note.md", "contract.pdf", "2026-06-11.md"].map((f) => (
        <span
          key={f}
          className="flex items-center gap-1 border border-dashed border-border bg-muted/40 px-2 py-1.5 font-mono text-[0.6rem] text-muted-foreground"
        >
          <FileTextIcon className="size-3 shrink-0" strokeWidth={1.5} /> {f}
        </span>
      ))}
    </div>
  )
}

function KnowledgePages() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {["Flat hunt", "Finances", "Health"].map((p) => (
        <span
          key={p}
          className="border border-border bg-card px-2 py-1.5 text-center font-mono text-[0.6rem] tracking-wider text-foreground uppercase"
        >
          {p}
        </span>
      ))}
    </div>
  )
}

export function ModelDiagram() {
  return (
    <div className="grid gap-px border border-border bg-border lg:grid-cols-3">
      {/* ── step 1: ingest ── */}
      <div className="flex flex-col bg-background p-7">
        <p className="label-caps text-rust">Step one</p>
        <h3 className="font-display mt-1 text-2xl font-semibold">Ingest</h3>
        <div className="mt-6 flex-1">
          <QuoteChip>"store this in my memory." — you, via any agent</QuoteChip>
          <FlowDown />
          <ZenodNode sub="files it on arrival" />
          <FlowDown />
          <EvidenceFiles />
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Everything you tell Zenod lands as{" "}
          <span className="text-foreground">evidence</span>: immutable,
          date-stamped files. Raw artifacts, never edited — a receipt for
          every memory.
        </p>
      </div>

      {/* ── step 2: curate ── */}
      <div className="flex flex-col bg-background p-7">
        <p className="label-caps text-rust">Step two</p>
        <h3 className="font-display mt-1 text-2xl font-semibold">Curate</h3>
        <div className="mt-6 flex-1">
          <EvidenceFiles muted />
          <FlowDown />
          <ZenodNode sub="in the background" />
          <FlowDown />
          <KnowledgeArcs />
          <KnowledgePages />
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          In the background, Zenod distills the raw artifacts into{" "}
          <span className="text-foreground">knowledge</span>: living, linked
          pages — areas, projects, ideas — where every claim cites the
          evidence it came from.
        </p>
      </div>

      {/* ── step 3: retrieve ── */}
      <div className="flex flex-col bg-background p-7">
        <p className="label-caps text-rust">Step three</p>
        <h3 className="font-display mt-1 text-2xl font-semibold">Retrieve</h3>
        <div className="mt-6 flex-1">
          <QuoteChip>"what did we decide on the flat hunt?"</QuoteChip>
          <FlowDown />
          <div className="grid grid-cols-2 gap-2">
            <span className="border border-border bg-card px-2 py-1.5 text-center font-mono text-[0.6rem] tracking-wider uppercase">
              The knowledge
            </span>
            <span className="border border-dashed border-border bg-muted/40 px-2 py-1.5 text-center font-mono text-[0.6rem] tracking-wider text-muted-foreground uppercase">
              The raw facts
            </span>
          </div>
          <FlowMerge />
          <ZenodNode sub="reads both tiers" />
          <FlowDown />
          <QuoteChip>
            an answer — <span className="text-rust not-italic">cited to the receipt</span>
          </QuoteChip>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Ask anything. Zenod answers from the knowledge, from the raw facts,
          or both combined — and every claim points back to its evidence.
        </p>
      </div>

      {/* ── the roles, in one strip ── */}
      <div className="bg-background p-5 lg:col-span-3">
        <p className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground sm:items-center sm:text-sm">
          <RefreshCwIcon className="mt-0.5 size-4 shrink-0 text-rust sm:mt-0" strokeWidth={1.5} />
          <span>
            <span className="label-caps text-foreground">Two roles, one engine</span>{" "}
            — the <span className="text-foreground">librarian</span> runs on
            every message (steps one and three, asks when unsure); the{" "}
            <span className="text-foreground">compactor</span> runs
            periodically (step two: merges duplicates, connects pages, adds no
            information).
          </span>
        </p>
      </div>
    </div>
  )
}
