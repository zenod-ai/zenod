import * as React from "react"
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  GitCommitIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  MinusIcon,
  NetworkIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BetDiagram } from "@/components/bet-diagram"
import { MemoryDiagram } from "@/components/memory-diagram"
import { ModelDiagram } from "@/components/model-diagram"
import { cn } from "@/lib/utils"
import alexandria from "@/assets/alexandria.jpg"
import zenodPlate from "@/assets/zenod-plate.jpg"
import {
  consumePendingHostedTier,
  createHostedCheckout,
  DASHBOARD_URL,
  type CustomerSession,
  type PaidTier,
  PRICING_OPTIONS,
  readCustomerSession,
  readProductionReadiness,
  SIGN_IN_PATH,
  SignInRequiredError,
} from "@/lib/customer"

const GITHUB_URL = "https://github.com/zenod-ai/zenod"
const DOCS_URL = "https://github.com/zenod-ai/zenod/tree/main/docs"
const DOCTRINE_URL = "https://github.com/zenod-ai/zenod/blob/main/docs/LIBRARIAN-DOCTRINE.md"
const ROADMAP_URL = "https://github.com/zenod-ai/zenod/blob/main/docs/ROADMAP.md"
const TERMS_URL = "/legal/terms.html"
const PRIVACY_URL = "/legal/privacy.html"
const DATA_URL = "/legal/data-handling.html"

const INSTALL_CMD = `git clone ${GITHUB_URL}.git && cd zenod
docker build -t zenod . && docker run -d -p 8080:8080 -v zenod-data:/data zenod`

const CONNECT_CMD = `claude mcp add --transport http zenod https://your-host/mcp`
const PENDING_TIER_KEY = "zenod.pending-checkout-tier"

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className="label-caps flex shrink-0 cursor-pointer items-center gap-1.5 text-muted-foreground transition-colors hover:text-rust"
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function CommandBlock({ step, title, command }: { step: string; title: string; command: string }) {
  return (
    <div className="border-t border-border">
      <div className="flex items-baseline justify-between gap-4 pt-3 pb-2">
        <span className="label-caps text-foreground">
          {step}. {title}
        </span>
        <CopyButton value={command} />
      </div>
      <pre className="overflow-x-auto border border-border bg-card px-4 py-3 text-left font-mono text-[0.78rem] leading-relaxed whitespace-pre text-foreground">
        {command}
      </pre>
    </div>
  )
}

function SectionHeading({ kicker, title, id }: { kicker: string; title: string; id?: string }) {
  return (
    <div id={id} className="mb-10 scroll-mt-24">
      <p className="label-caps mb-3 text-rust">{kicker}</p>
      <h2 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
    </div>
  )
}

function Yes({ note }: { note?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-rust">
      <CheckIcon className="size-4 shrink-0" strokeWidth={2.5} />
      {note ? <span className="text-xs text-foreground/80">{note}</span> : null}
    </span>
  )
}

function No({ note }: { note?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground/70">
      <XIcon className="size-4 shrink-0" />
      {note ? <span className="text-xs">{note}</span> : null}
    </span>
  )
}

function Partial({ note }: { note?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <MinusIcon className="size-4 shrink-0" />
      {note ? <span className="text-xs">{note}</span> : null}
    </span>
  )
}

interface CustomerJourney {
  session: CustomerSession | null
  loading: boolean
  busyTier: PaidTier | null
  error: string | null
  paidSignupReady: boolean
  subscribe: (tier: PaidTier) => void
}

function isPaidTier(value: string | null): value is PaidTier {
  return value === "monthly"
}

function useCustomerJourney(): CustomerJourney {
  const [session, setSession] = React.useState<CustomerSession | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busyTier, setBusyTier] = React.useState<PaidTier | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [paidSignupReady, setPaidSignupReady] = React.useState(false)

  const beginCheckout = React.useCallback(async (tier: PaidTier) => {
    setBusyTier(tier)
    setError(null)
    try {
      const destination = await createHostedCheckout(tier)
      window.location.assign(destination)
    } catch (checkoutError) {
      if (checkoutError instanceof SignInRequiredError) {
        window.sessionStorage.setItem(PENDING_TIER_KEY, tier)
        window.location.assign(SIGN_IN_PATH)
        return
      }
      setError(checkoutError instanceof Error ? checkoutError.message : "Could not start checkout")
      setBusyTier(null)
    }
  }, [])

  React.useEffect(() => {
    let active = true
    readCustomerSession()
      .then((customer) => {
        if (!active) return
        setSession(customer)
        setLoading(false)

        const pending = consumePendingHostedTier(window.sessionStorage, PENDING_TIER_KEY)
        if (customer && isPaidTier(pending)) {
          void beginCheckout(pending)
        }
      })
      .catch(() => {
        if (!active) return
        setSession(null)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [beginCheckout])

  React.useEffect(() => {
    let active = true
    readProductionReadiness()
      .then((readiness) => {
        if (active) setPaidSignupReady(readiness.ready && readiness.publicPaidSignup)
      })
      .catch(() => {
        if (active) setPaidSignupReady(false)
      })
    return () => {
      active = false
    }
  }, [])

  const subscribe = React.useCallback(
    (tier: PaidTier) => {
      if (loading || !session) {
        window.sessionStorage.setItem(PENDING_TIER_KEY, tier)
        window.location.assign(SIGN_IN_PATH)
        return
      }
      void beginCheckout(tier)
    },
    [beginCheckout, loading, session],
  )

  return { session, loading, busyTier, error, paidSignupReady, subscribe }
}

function SiteHeader({ customer }: { customer: CustomerJourney }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex min-h-16 items-stretch justify-between">
        <a
          href="/"
          className="font-display flex items-center border-r border-border px-4 text-xl font-bold sm:px-6 sm:text-2xl"
        >
          ZENOD
        </a>
        <nav className="flex min-w-0 flex-1 items-center justify-end text-sm">
          <a
            href="/pricing"
            className="hidden h-full items-center px-4 text-muted-foreground transition-colors hover:text-rust sm:flex"
          >
            Pricing
          </a>
          {customer.session ? (
            <>
              <span className="hidden max-w-40 truncate px-3 text-muted-foreground md:block">
                {customer.session.login}
              </span>
              <a
                href={DASHBOARD_URL}
                className="flex h-full items-center gap-2 border-l border-border px-4 font-medium transition-colors hover:text-rust sm:px-5"
              >
                <LayoutDashboardIcon className="size-4" />
                Dashboard
              </a>
            </>
          ) : (
            <a
              href={SIGN_IN_PATH}
              className="flex h-full items-center gap-2 border-l border-border px-4 font-medium transition-colors hover:text-rust sm:px-5"
            >
              <GithubIcon className="size-4" />
              <span className="hidden sm:inline">GitHub </span>Sign in
            </a>
          )}
          <a
            href="/pricing"
            className="flex h-full items-center bg-foreground px-4 font-semibold text-background transition-colors hover:bg-rust sm:px-5"
          >
            Get started
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Zenod on GitHub"
            className="hidden h-full items-center border-l border-border px-5 transition-colors hover:text-rust lg:flex"
          >
            <GithubIcon className="size-5" />
          </a>
        </nav>
      </div>
    </header>
  )
}

function PricingSection({ customer }: { customer: CustomerJourney }) {
  return (
    <section id="pricing" className="scroll-mt-20 border-b border-border px-6 py-20 sm:px-12">
      <SectionHeading kicker="Simple pricing" title="Keep the library. Choose who runs it." />
      <div className="grid border border-border lg:grid-cols-2">
        {PRICING_OPTIONS.map((plan, index) => (
          <article
            key={plan.name}
            className={cn(
              "flex min-h-[23rem] flex-col p-6 sm:p-8",
              index > 0 && "border-t border-border lg:border-t-0 lg:border-l",
            )}
          >
            <h3 className="font-display text-2xl font-semibold">{plan.name}</h3>
            <div className="mt-6 flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold">{plan.price}</span>
              <span className="text-sm text-muted-foreground">{plan.cadence}</span>
            </div>
            <p className="mt-5 flex-1 text-sm leading-relaxed text-muted-foreground">
              {plan.description}
            </p>
            <div className="mt-8">
              {plan.tier === null ? (
                <Button asChild size="lg" variant="outline" className="w-full rounded-none">
                  <a href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer">
                    <GithubIcon data-icon="inline-start" />
                    View install guide
                  </a>
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full rounded-none"
                  disabled={customer.busyTier !== null || !customer.paidSignupReady}
                  onClick={() => plan.tier && customer.subscribe(plan.tier)}
                >
                  {customer.busyTier === plan.tier
                    ? "Opening checkout…"
                    : customer.paidSignupReady
                      ? "Choose Hosted"
                      : "Hosted beta opening soon"}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {customer.error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {customer.error}. Please retry.
        </p>
      ) : null}
      <p className="label-caps mt-5 text-muted-foreground/70">
        {customer.paidSignupReady
          ? "Paid plans use Stripe checkout. Sign in with a supported Google or GitHub account."
          : "Hosted signups open only after billing, legal, support, and restore checks are green."}
      </p>
    </section>
  )
}

const comparisonRows: Array<{
  capability: string
  zenod: React.ReactNode
  basicMemory: React.ReactNode
  rawMcp: React.ReactNode
  memoryApis: React.ReactNode
}> = [
  {
    capability: "Memory you can open in a text editor",
    zenod: <Yes note="Markdown in your GitHub or Drive" />,
    basicMemory: <Yes note="markdown files" />,
    rawMcp: <Yes note="your vault" />,
    memoryApis: <No note="their database" />,
  },
  {
    capability: "Organization enforced by the server",
    zenod: <Yes note="the core thesis" />,
    basicMemory: <No note="optional agent-side skills" />,
    rawMcp: <No note="raw file CRUD" />,
    memoryApis: <No note="opaque auto-extraction" />,
  },
  {
    capability: "Every memory is a git commit",
    zenod: <Yes note="provenance link per fact" />,
    basicMemory: <No note="git incidental" />,
    rawMcp: <No />,
    memoryApis: <No />,
  },
  {
    capability: "Answers questions, not just retrieval",
    zenod: <Yes note="ask_brain synthesizes + cites" />,
    basicMemory: <Partial note="context blobs" />,
    rawMcp: <No />,
    memoryApis: <No note="returns memory lists" />,
  },
  {
    capability: "Any agent can connect (MCP)",
    zenod: <Yes note="OAuth 2.1 / bearer" />,
    basicMemory: <Yes />,
    rawMcp: <Yes />,
    memoryApis: <Partial note="varies" />,
  },
]

const categories = [
  {
    name: "Markdown memory services",
    examples: "Basic Memory",
    gap: "Curation is optional skills the calling agent may ignore — the server doesn't enforce the library's order.",
  },
  {
    name: "Raw Obsidian MCP servers",
    examples: "mcp-obsidian, official plugin",
    gap: "Zero intelligence. Every agent re-derives your conventions and erodes them over time.",
  },
  {
    name: "Client-side curation kits",
    examples: "obsidian-mind",
    gap: "Right philosophy, wrong architecture: per-CLI hooks, local files only, nothing guards a remote agent.",
  },
  {
    name: "Memory-as-API platforms",
    examples: "Mem0, supermemory, Zep, Letta",
    gap: "Your memory lives in their database, in their format. You can't read it, diff it, or walk away with it.",
  },
]

function LandingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <div className="paper-grain min-h-screen">
      <div className="mx-auto max-w-6xl border-x border-border">
        <SiteHeader customer={customer} />

        {/* ───────────────────────── hero ───────────────────────── */}
        <section className="relative overflow-hidden border-b border-border">
          <img
            src={alexandria}
            alt=""
            aria-hidden
            className="duotone pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.14]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1fr_minmax(0,26rem)]">
            <div className="text-center lg:text-left">
              <p className="label-caps mb-6 text-rust">Open-source self-hosted · Zenod Hosted</p>
              <h1 className="font-display text-5xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl xl:text-7xl">
                The librarian your agents report to.
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground max-lg:mx-auto">
                Zenod is the memory agent that runs your personal library. It files every piece of
                evidence, distills it into living ideas, and serves your knowledge to every AI agent
                you use — one brain across all of them. Self-host free with your AI provider and
                Telegram, or choose Zenod Hosted for €9/month + VAT with managed AI usage and
                WhatsApp included. Your memory stays plain Markdown in{" "}
                <em className="text-foreground not-italic">your</em> GitHub or Google Drive account.
              </p>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <Button asChild size="lg" className="rounded-none px-6">
                  <a href="/pricing">
                    Get started
                    <ArrowUpRightIcon data-icon="inline-end" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-none px-6">
                  <a href={SIGN_IN_PATH}>
                    <GithubIcon data-icon="inline-start" />
                    Sign in with GitHub
                  </a>
                </Button>
              </div>
            </div>

            {/* The plate — Zenod himself, hung like museum art on the paper wall. */}
            <figure className="mx-auto w-full max-w-xs sm:max-w-sm lg:max-w-none">
              <img
                src={zenodPlate}
                alt="Zenod, the Librarian — engraved allegorical plate: a marble librarian with gilded scrolls and an open codex"
                className="w-full border border-border bg-black shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)]"
              />
              <figcaption className="label-caps mt-3 text-center text-muted-foreground/70">
                Zenod · the librarian that keeps your thoughts
              </figcaption>
            </figure>
          </div>

          <div className="relative mx-auto max-w-3xl px-6 pb-20 text-center">
            <div id="self-host" className="mx-auto max-w-2xl scroll-mt-24 space-y-6 text-left">
              <CommandBlock step="1" title="Install" command={INSTALL_CMD} />
              <CommandBlock step="2" title="Connect your agents" command={CONNECT_CMD} />
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="outline" className="rounded-none px-5">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <GithubIcon data-icon="inline-start" />
                  Star on GitHub
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-none px-5">
                <a href={DOCS_URL} target="_blank" rel="noreferrer">
                  Read the docs
                  <ArrowUpRightIcon data-icon="inline-end" />
                </a>
              </Button>
            </div>
            <p className="label-caps mt-4 text-muted-foreground/70">
              Self-host free: your AI provider + Telegram · Hosted: €9/month + VAT, managed usage +
              WhatsApp
            </p>
          </div>
        </section>

        <PricingSection customer={customer} />

        {/* ───────────────────────── use case ───────────────────────── */}
        <section className="border-b border-border px-6 py-20 sm:px-12">
          <SectionHeading kicker="The use case" title="Your memory, defragmented." />
          <MemoryDiagram />
        </section>

        {/* ───────────────────────── pillars ───────────────────────── */}
        <section className="border-b border-border">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: LibraryIcon,
                title: "Evidence becomes ideas",
                body: "Every capture is filed verbatim — immutable, date-stamped, a receipt. Then it's distilled into living pages of meaning, and every claim cites the evidence that produced it.",
              },
              {
                icon: NetworkIcon,
                title: "Every agent, one memory",
                body: "Claude, Codex, anything that speaks MCP — they all read and write the same brain. Agents never get raw file access; they ask the librarian, and the librarian keeps order.",
              },
              {
                icon: KeyRoundIcon,
                title: "You hold the keys",
                body: "Your vault is ordinary Markdown in your GitHub repository or app-created Google Drive folder. Self-hosted runs on your server with your AI provider key; Hosted manages the service for you. Open it in Obsidian any time. Export with zero loss — it's just files.",
              },
              {
                icon: GitCommitIcon,
                title: "Auditable to the commit",
                body: "Every memory Zenod stores is a git commit. git log is the audit trail; human and agent writing are always distinguishable. No opaque database that 'just gets better.'",
              },
            ].map(({ icon: Icon, title, body }, i) => (
              <div
                key={title}
                className={cn(
                  "border-border p-8",
                  i > 0 && "border-t sm:border-t-0",
                  "sm:[&:nth-child(even)]:border-l lg:border-l",
                  i === 0 && "lg:border-l-0",
                )}
              >
                <Icon className="size-5 text-rust" strokeWidth={1.5} />
                <h3 className="font-display mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ───────────────────────── how it works ───────────────────────── */}
        <section className="border-b border-border px-6 py-20 sm:px-12">
          <SectionHeading kicker="The model" title="Ingest. Curate. Retrieve." />
          <ModelDiagram />
        </section>

        {/* ───────────────────────── the bet ───────────────────────── */}
        <section className="border-b border-border px-6 py-20 sm:px-12">
          <SectionHeading kicker="The bet" title="Everybody reads. One writes." />
          <p className="-mt-4 mb-10 max-w-2xl leading-relaxed text-muted-foreground">
            Zenod is an opinionated bet on structure. You won't be married to one agent — you'll use
            ten, each good at something different. What can't survive that world is scattered
            context. So: one library, open to every reader, with a single gatekeeper holding the
            pen.
          </p>
          <BetDiagram />
          <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2">
            {[
              {
                title: "Your data, period.",
                body: "The library is ordinary Markdown in your private GitHub repository or app-created Drive folder. It exists with or without us, readable by anything you authorize. The engine is open source (AGPL) — nothing funny going on.",
              },
              {
                title: "A librarian you hire, not a landlord.",
                body: "Zenod is a memory manager you hire to keep that vault tidy. Switch managers any time and the library stays — every book, every index. We're betting you'll stay because we're good at the job.",
              },
              {
                title: "Ten agents, zero retraining.",
                body: "Don't teach ten agents your filing system and hope they comply. They all talk to the gatekeeper; the gatekeeper enforces the rules. Your context stays whole, no matter what's on the other end.",
              },
              {
                title: "Tidiness is what intelligence grows on.",
                body: "Keep the dots filed and cited, and higher structure emerges from connecting them — areas, ideas, lines of thinking. A tidy library compounds; a junk drawer just accumulates.",
              },
            ].map((t) => (
              <div key={t.title} className="bg-background p-6">
                <h3 className="font-display text-lg font-semibold">{t.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            And this librarian is just getting started —{" "}
            <a
              href={ROADMAP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-rust underline-offset-4 hover:underline"
            >
              see the roadmap
            </a>
            .
          </p>
        </section>

        {/* ───────────────────────── philosophy ───────────────────────── */}
        <section className="border-b border-border px-6 py-20 sm:px-12">
          <SectionHeading
            id="philosophy"
            kicker="The philosophy"
            title="Filing discipline as code, not willpower."
          />
          <div className="grid gap-12 lg:grid-cols-5">
            <div className="space-y-6 leading-relaxed text-muted-foreground lg:col-span-3">
              <p>
                <span className="text-foreground">
                  The LLM is the librarian. You're the curator.
                </span>{" "}
                Zenod's write path is the product: agents can't produce a disorganized vault,
                because the rules live in the service — deterministic validation code, not prompts a
                caller might ignore.
              </p>
              <p>
                The vault schema is fixed and machine-enforced: immutable captures on one tier,
                distilled entity pages on the other; shallow folders, links over hierarchy,
                controlled vocabulary; a note without links is a bug. Renames, merges and migrations
                are proposal-first — the librarian plans, you approve.
              </p>
              <p>
                And against vault pollution — the deepest objection to letting an AI near your notes
                — <span className="text-foreground">provenance is first-class</span>: human-authored
                and agent-written are always distinguishable, and agents never edit your thinking
                notes.
              </p>
              <p>
                <a
                  href={DOCTRINE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="label-caps text-rust underline-offset-4 hover:underline"
                >
                  Read the full Librarian Doctrine
                  <ArrowUpRightIcon className="ml-1 inline size-3" />
                </a>
              </p>
            </div>
            <figure className="border-l-2 border-rust pl-6 lg:col-span-2">
              <blockquote className="font-display text-xl leading-relaxed text-foreground italic">
                "Instead of just retrieving from raw documents at query time, the LLM incrementally
                builds and maintains a persistent wiki."
              </blockquote>
              <figcaption className="label-caps mt-4 text-muted-foreground">
                Andrej Karpathy — LLM Knowledge Bases, April 2026
              </figcaption>
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                Karpathy gave the world the recipe. Zenod is the restaurant — the same pattern
                delivered as a service with an enforced write path, instead of a manual workflow.
              </p>
            </figure>
          </div>
        </section>

        {/* ───────────────────────── comparison ───────────────────────── */}
        <section className="border-b border-border px-6 py-20 sm:px-12">
          <SectionHeading id="compare" kicker="The landscape" title="Where Zenod stands." />

          <div className="overflow-x-auto border border-border">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="label-caps p-4 text-left font-medium text-muted-foreground">
                    Capability
                  </th>
                  <th className="label-caps border-l border-border bg-rust/5 p-4 text-left font-medium text-rust">
                    Zenod
                  </th>
                  <th className="label-caps border-l border-border p-4 text-left font-medium text-muted-foreground">
                    Basic Memory
                  </th>
                  <th className="label-caps border-l border-border p-4 text-left font-medium text-muted-foreground">
                    Raw Obsidian MCP
                  </th>
                  <th className="label-caps border-l border-border p-4 text-left font-medium text-muted-foreground">
                    Memory APIs
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.capability} className="border-b border-border last:border-b-0">
                    <td className="p-4 font-medium">{row.capability}</td>
                    <td className="border-l border-border bg-rust/5 p-4">{row.zenod}</td>
                    <td className="border-l border-border p-4">{row.basicMemory}</td>
                    <td className="border-l border-border p-4">{row.rawMcp}</td>
                    <td className="border-l border-border p-4">{row.memoryApis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-rust" />
            Honest reading: competitor checkmarks are shipped at scale; Zenod is early-access running
            code with a gated hosted beta. Memory APIs = Mem0, supermemory, Zep, Letta. And two things we
            deliberately concede: local-first purism, and benchmark recall at enterprise scale.
            That's the funded players' game. Ours is a library you own.
          </p>

          <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2">
            {categories.map((c) => (
              <div key={c.name} className="bg-background p-6">
                <h3 className="font-display text-lg font-semibold">{c.name}</h3>
                <p className="label-caps mt-1 text-muted-foreground">{c.examples}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.gap}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ───────────────────────── the name ───────────────────────── */}

        <section className="relative overflow-hidden border-b border-border">
          <div className="grid lg:grid-cols-2">
            <div className="relative min-h-72 border-b border-border lg:border-r lg:border-b-0">
              <img
                src={alexandria}
                alt="The Great Library of Alexandria, 19th-century engraving by O. Von Corven"
                className="duotone absolute inset-0 h-full w-full object-cover opacity-70"
              />
            </div>
            <div className="px-6 py-16 sm:px-12">
              <p className="label-caps mb-3 text-rust">The name</p>
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Zenodotus of Ephesus, first librarian of Alexandria.
              </h2>
              <div className="mt-6 space-y-4 leading-relaxed text-muted-foreground">
                <p>
                  The Library of Alexandria didn't just collect scrolls — it appointed a librarian.
                  Zenodotus invented alphabetical organization, attached identifying tags to every
                  scroll, and turned a pile of papyrus into the ancient world's memory.
                </p>
                <p>
                  That's the job here. Your captures, conversations, documents and voice notes are
                  the scrolls. Zenod is the librarian: it decides where things go, keeps the catalog
                  coherent, and hands any agent exactly the scroll it asked for — while the
                  collection stays yours.
                </p>
              </div>
              <p className="label-caps mt-8 text-muted-foreground">Pronounced ZEN-od · zenod.dev</p>
            </div>
          </div>
        </section>

        {/* ───────────────────────── footer ───────────────────────── */}
        <footer className="px-6 py-12 sm:px-12">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <div>
              <p className="font-display text-2xl font-bold tracking-tight">ZENOD</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Self-host Zenod free with your AI provider and Telegram, or choose Zenod Hosted for
                €9/month + VAT with managed AI usage and WhatsApp included.
              </p>
            </div>
            <nav className="label-caps flex flex-wrap gap-x-8 gap-y-3 text-muted-foreground">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 transition-colors hover:text-rust"
              >
                <GithubIcon className="size-3.5" /> GitHub
              </a>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 transition-colors hover:text-rust"
              >
                <BookOpenIcon className="size-3.5" /> Docs
              </a>
              <a
                href={ROADMAP_URL}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-rust"
              >
                Roadmap
              </a>
              <a
                href={`${GITHUB_URL}/blob/main/LICENSE`}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-rust"
              >
                AGPL-3.0
              </a>
              <a href={TERMS_URL} className="transition-colors hover:text-rust">
                Terms
              </a>
              <a href={PRIVACY_URL} className="transition-colors hover:text-rust">
                Privacy
              </a>
              <a href={DATA_URL} className="transition-colors hover:text-rust">
                Data
              </a>
            </nav>
          </div>
          <p className="label-caps mt-10 border-t border-border pt-6 text-muted-foreground/70">
            Engraving: the Great Library of Alexandria, O. Von Corven, 19th c. (public domain)
          </p>
        </footer>
      </div>
    </div>
  )
}

function PricingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <div className="paper-grain min-h-screen">
      <div className="mx-auto min-h-screen max-w-6xl border-x border-border">
        <SiteHeader customer={customer} />
        <main>
          <div className="border-b border-border px-6 pt-16 sm:px-12 sm:pt-20">
            <p className="label-caps mb-4 text-rust">Zenod plans</p>
            <h1 className="font-display max-w-3xl text-4xl font-semibold sm:text-5xl">
              Your agents share one library. You decide where it runs.
            </h1>
            <p className="mt-6 max-w-2xl pb-14 leading-relaxed text-muted-foreground">
              Self-host free with your AI provider and Telegram, or choose Zenod Hosted for €9/month
              + VAT with managed AI usage and WhatsApp included. Either way, your memory stays in a
              plain Markdown in your GitHub repository or app-created Google Drive folder.
            </p>
          </div>
          <PricingSection customer={customer} />
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:px-12">
          <span>Zenod · AGPL-3.0</span>
          <a href={GITHUB_URL} className="inline-flex items-center gap-2 hover:text-rust">
            <GithubIcon className="size-4" /> GitHub
          </a>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  const customer = useCustomerJourney()
  return window.location.pathname === "/pricing" ? (
    <PricingPage customer={customer} />
  ) : (
    <LandingPage customer={customer} />
  )
}
