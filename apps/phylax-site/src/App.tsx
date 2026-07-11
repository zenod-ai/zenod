import * as React from "react"
import { ArrowRightIcon, CheckIcon, GitBranchIcon, ShieldCheckIcon } from "lucide-react"

// DUPLICATED from the shipped Ring/Zenod customer landing; only Phylax product copy/config differs.

import { Button } from "@/components/ui/button"
import {
  createHostedCheckout,
  DASHBOARD_URL,
  type CustomerSession,
  type PaidTier,
  PRICING_OPTIONS,
  readCustomerSession,
  SIGN_IN_PATH,
  SignInRequiredError,
} from "@/lib/customer"

const PENDING_TIER_KEY = "phylax.pending-checkout-tier"

function useCustomerJourney() {
  const [session, setSession] = React.useState<CustomerSession | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busyTier, setBusyTier] = React.useState<PaidTier | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const beginCheckout = React.useCallback(async (tier: PaidTier) => {
    setBusyTier(tier)
    setError(null)
    try {
      window.location.assign(await createHostedCheckout(tier))
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
        const pending = window.sessionStorage.getItem(PENDING_TIER_KEY)
        if (customer && (pending === "monthly" || pending === "yearly")) {
          window.sessionStorage.removeItem(PENDING_TIER_KEY)
          void beginCheckout(pending)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [beginCheckout])

  const subscribe = (tier: PaidTier) => {
    if (!session) {
      window.sessionStorage.setItem(PENDING_TIER_KEY, tier)
      window.location.assign(SIGN_IN_PATH)
      return
    }
    void beginCheckout(tier)
  }

  return { session, loading, busyTier, error, subscribe }
}

function Header({ session, loading }: { session: CustomerSession | null; loading: boolean }) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between px-5">
        <a href="/" className="font-display text-xl font-bold tracking-tight">PHYLAX</a>
        <nav className="flex items-center gap-2 text-sm">
          <a href="/pricing" className="px-3 py-2 text-muted-foreground hover:text-foreground">Pricing</a>
          {!loading && session ? (
            <>
              <span className="hidden text-muted-foreground sm:inline">{session.login}</span>
              <Button asChild size="sm"><a href={DASHBOARD_URL}>Dashboard</a></Button>
            </>
          ) : (
            <Button asChild size="sm" variant="outline"><a href={SIGN_IN_PATH}><GitBranchIcon />Sign in with GitHub</a></Button>
          )}
        </nav>
      </div>
    </header>
  )
}

function Pricing({ subscribe, busyTier, error }: ReturnType<typeof useCustomerJourney>) {
  return (
    <section id="pricing" className="border-t border-border px-5 py-20">
      <div className="mx-auto max-w-6xl">
        <p className="label-caps mb-3 text-rust">Simple pricing</p>
        <h2 className="font-display mb-10 text-4xl font-semibold">Choose how your agents reach you.</h2>
        <div className="grid gap-px bg-border md:grid-cols-3">
          {PRICING_OPTIONS.map((plan) => (
            <article key={plan.name} className="flex min-h-72 flex-col bg-background p-7">
              <h3 className="font-display text-2xl font-semibold">{plan.name}</h3>
              <p className="mt-4 text-3xl font-semibold">{plan.price}</p>
              <p className="text-sm text-muted-foreground">{plan.cadence}</p>
              <p className="mt-6 flex-1 text-sm leading-6 text-muted-foreground">{plan.description}</p>
              {plan.tier ? (
                <Button disabled={busyTier !== null} onClick={() => subscribe(plan.tier!)}>
                  {busyTier === plan.tier ? "Opening checkout…" : "Subscribe"}
                </Button>
              ) : (
                <Button asChild variant="outline"><a href="https://github.com/zenod-ai/zenod/tree/main/units/phylax">Self-host</a></Button>
              )}
            </article>
          ))}
        </div>
        {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
      </div>
    </section>
  )
}

function Landing() {
  const customer = useCustomerJourney()
  return (
    <>
      <Header session={customer.session} loading={customer.loading} />
      <main>
        <section className="px-5 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <p className="label-caps mb-5 text-rust">One channel for all your agents</p>
            <h1 className="font-display max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
              Your agents, on WhatsApp &amp; Telegram.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
              Phylax gives every agent one tenant-scoped path to the messaging apps you already use,
              with verified senders, transcription, and delivery receipts.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg"><a href={customer.session ? DASHBOARD_URL : SIGN_IN_PATH}>Get started <ArrowRightIcon /></a></Button>
              <Button asChild size="lg" variant="outline"><a href="/pricing">Pricing</a></Button>
            </div>
          </div>
        </section>
        <section className="border-t border-border px-5 py-16">
          <div className="mx-auto grid max-w-6xl gap-px bg-border md:grid-cols-3">
            {["WhatsApp and Telegram", "Verified sender isolation", "Receipts for every delivery"].map((item) => (
              <div key={item} className="flex items-center gap-3 bg-background p-7"><ShieldCheckIcon className="text-rust" /><span>{item}</span></div>
            ))}
          </div>
        </section>
        <Pricing {...customer} />
      </main>
      <footer className="border-t border-border px-5 py-8 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between"><span>Phylax · AGPL-3.0</span><span className="flex items-center gap-2"><CheckIcon className="size-4" />GitHub-only identity</span></div>
      </footer>
    </>
  )
}

export default function App() {
  return <Landing />
}
