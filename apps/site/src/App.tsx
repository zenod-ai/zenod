import * as React from "react";
import { SlotText } from "slot-text/react";
import { chromatic } from "slot-text";
import "slot-text/style.css";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
} from "lucide-react";

import heroLibrarian from "@/assets/zenod-v5-hero-librarian.webp";
import { ClosingStorySection, StoryFlow } from "@/components/story-flow";
import { cn } from "@/lib/utils";
import {
  consumePendingHostedTier,
  createHostedCheckout,
  DASHBOARD_URL,
  GOOGLE_SIGN_IN_PATH,
  type CustomerSession,
  type PaidTier,
  PRICING_OPTIONS,
  readCustomerSession,
  readProductionReadiness,
  SIGN_IN_PATH,
  SignInRequiredError,
} from "@/lib/customer";

const GITHUB_URL = "https://github.com/zenod-ai/zenod";
const DOCS_URL = "https://github.com/zenod-ai/zenod/tree/main/docs";
const TERMS_URL = "/legal/terms.html";
const PRIVACY_URL = "/legal/privacy.html";
const DATA_URL = "/legal/data-handling.html";
const PENDING_TIER_KEY = "zenod.pending-checkout-tier";

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

interface CustomerJourney {
  session: CustomerSession | null;
  loading: boolean;
  busyTier: PaidTier | null;
  error: string | null;
  paidSignupReady: boolean;
  subscribe: (tier: PaidTier) => void;
}

function useCustomerJourney(): CustomerJourney {
  const [session, setSession] = React.useState<CustomerSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyTier, setBusyTier] = React.useState<PaidTier | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [paidSignupReady, setPaidSignupReady] = React.useState(false);

  const beginCheckout = React.useCallback(async (tier: PaidTier) => {
    setBusyTier(tier);
    setError(null);
    try {
      window.location.assign(await createHostedCheckout(tier));
    } catch (checkoutError) {
      if (checkoutError instanceof SignInRequiredError) {
        window.sessionStorage.setItem(PENDING_TIER_KEY, tier);
        window.location.assign(SIGN_IN_PATH);
        return;
      }
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not start checkout",
      );
      setBusyTier(null);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    readCustomerSession()
      .then((customer) => {
        if (!active) return;
        setSession(customer);
        setLoading(false);
        const pending = consumePendingHostedTier(
          window.sessionStorage,
          PENDING_TIER_KEY,
        );
        if (customer && pending === "monthly") void beginCheckout(pending);
      })
      .catch(() => {
        if (active) {
          setSession(null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [beginCheckout]);

  React.useEffect(() => {
    let active = true;
    readProductionReadiness()
      .then((readiness) => {
        if (active)
          setPaidSignupReady(readiness.ready && readiness.publicPaidSignup);
      })
      .catch(() => {
        if (active) setPaidSignupReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const subscribe = React.useCallback(
    (tier: PaidTier) => {
      if (loading || !session) {
        window.sessionStorage.setItem(PENDING_TIER_KEY, tier);
        window.location.assign(SIGN_IN_PATH);
        return;
      }
      void beginCheckout(tier);
    },
    [beginCheckout, loading, session],
  );

  return { session, loading, busyTier, error, paidSignupReady, subscribe };
}

function SiteHeader({ customer }: { customer: CustomerJourney }) {
  return (
    <header className="v5-nav">
      <div className="v5-wrap v5-nav-inner">
        <a className="v5-brand" href="/" aria-label="Zenod home">
          ZENOD
          <span aria-hidden="true" />
        </a>
        <nav className="v5-nav-links" aria-label="Primary">
          <a href="/#ownership">Why memory</a>
          <a href="/#capture">Examples</a>
          <a href="/#alexandria">The librarian</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <div className="v5-nav-actions">
          {customer.session ? (
            <a className="v5-button v5-button-small" href={DASHBOARD_URL}>
              <LayoutDashboardIcon /> Dashboard
            </a>
          ) : (
            <>
              <a className="v5-signin" href={GOOGLE_SIGN_IN_PATH}>
                <KeyRoundIcon /> Sign in
              </a>
              <a
                className="v5-signin v5-github-signin"
                href={SIGN_IN_PATH}
                aria-label="Sign in with GitHub"
              >
                <GithubIcon />
              </a>
            </>
          )}
          <a
            className="v5-button v5-button-small v5-button-primary"
            href="/pricing"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

function StarLink() {
  const [active, setActive] = React.useState(false);
  return (
    <a className="v5-button v5-star-link" href={GITHUB_URL} target="_blank" rel="noreferrer"
      aria-label="Star Zenod on GitHub"
      onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)} onBlur={() => setActive(false)}>
      <GithubIcon />
      <SlotText text={active ? "Give us a star" : "Star on GitHub"} options={{ rollBy: "word", color: chromatic(), direction: "up", duration: 320, stagger: 40, bounce: 0.08 }} />
    </a>
  );
}

function SectionTitle({
  no,
  kicker,
  title,
  lead,
}: {
  no: string;
  kicker: string;
  title: React.ReactNode;
  lead?: string;
}) {
  return (
    <>
      <span className="v5-section-no">{no}</span>
      <p className="v5-kicker">{kicker}</p>
      <h2>{title}</h2>
      {lead ? <p className="v5-lead">{lead}</p> : null}
    </>
  );
}

function PricingSection({ customer }: { customer: CustomerJourney }) {
  return (
    <section className="v5-section" id="start">
      <div className="v5-wrap">
        <SectionTitle
          no="08 / RUN IT YOUR WAY"
          kicker="Self-host or hosted"
          title="Run it your way."
          lead="The same open-source engine can run on your infrastructure or ours. The library stays yours."
        />
        <div className="v5-plans">
          {PRICING_OPTIONS.map((plan) => (
            <article
              key={plan.name}
              className={cn("v5-plan", plan.tier && "v5-plan-hosted")}
            >
              <span className="v5-micro">
                {plan.tier ? "ZENOD HOSTED" : "OPEN SOURCE"}
              </span>
              <div className="v5-price">
                {plan.price} <small>{plan.cadence}</small>
              </div>
              <p>{plan.description}</p>
              {plan.tier ? (
                <button
                  className="v5-button v5-button-primary"
                  disabled={
                    customer.busyTier !== null || !customer.paidSignupReady
                  }
                  onClick={() => plan.tier && customer.subscribe(plan.tier)}
                >
                  {customer.busyTier === plan.tier
                    ? "Opening checkout…"
                    : customer.paidSignupReady
                      ? "Choose Hosted"
                      : "Hosted beta opening soon"}
                  <ArrowUpRightIcon />
                </button>
              ) : (
                <a
                  className="v5-button"
                  href={`${GITHUB_URL}#readme`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GithubIcon /> View install guide
                </a>
              )}
            </article>
          ))}
        </div>
        {customer.error ? (
          <p className="v5-error">{customer.error}. Please retry.</p>
        ) : null}
        <p className="v5-offer-truth">
          Self-host Zenod free with your AI provider and Telegram. Zenod Hosted
          is €9/month + VAT with managed AI usage and WhatsApp included.
          Hosted: GitHub or Drive · self-hosted: GitHub.
        </p>
      </div>
    </section>
  );
}

const verbs = ["contribute to.", "enrich.", "access.", "cultivate."];

function MemoryRoll() {
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!motion.matches && !document.hidden) {
        timer = setInterval(() => setIndex((value) => (value + 1) % verbs.length), 3200);
      }
    };
    sync();
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <div className="v5-verb-line" aria-label="Your memory, yours to contribute to, enrich, access, and cultivate.">
      <span aria-hidden="true">Your memory, yours to</span>
      <span className="v5-memory-roll" aria-hidden="true">
        <SlotText text={verbs[index]} options={{ rollBy: "word", color: chromatic(), colorFade: 650, direction: "up", duration: 500, stagger: 55, bounce: 0.12, exitOffset: 0 }} />
      </span>
    </div>
  );
}

function LandingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <div className="v5-site">
      <SiteHeader customer={customer} />
      <main>
        <section className="v5-hero">
          <img
            className="v5-hero-art"
            src={heroLibrarian}
            alt="The Librarian of Alexandria emerging from a network of connected memories"
          />
          <div className="v5-hero-shade" />
          <div className="v5-wrap v5-hero-inner">
            <div className="v5-hero-copy">
              <p className="v5-eyebrow">The memory layer you control</p>
              <h1>
                Your agents.
                <span className="v5-cyan">One memory.</span>
                <span className="v5-acid">Totally yours.</span>
              </h1>
              <p className="v5-lead">
                Every agent works better with the right context. Zenod keeps it
                organized, portable, and yours.
              </p>
              <div className="v5-actions">
                <a className="v5-button v5-button-primary" href="#start">
                  Try Zenod free
                </a>
                <StarLink />
              </div>
              <MemoryRoll />
            </div>
          </div>
          <div className="v5-identity">
            <b>ZENOD · THE LIBRARIAN</b>
            <span>ALEXANDRIA / REBUILT FOR AGENTS</span>
          </div>
          <div className="v5-wrap v5-proof">
            <div>
              <b>Yours</b>
              <span>MARKDOWN + GIT</span>
            </div>
            <div>
              <b>Portable</b>
              <span>MODEL INDEPENDENT</span>
            </div>
            <div>
              <b>Connected</b>
              <span>MCP NATIVE</span>
            </div>
            <div>
              <b>Maintained</b>
              <span>ONE GATEKEEPER</span>
            </div>
          </div>
        </section>

        <StoryFlow offer={<PricingSection customer={customer} />} />

        <section className="v5-section" id="faq">
          <div className="v5-wrap v5-faq">
            <div>
              <SectionTitle
                no="FINAL CHECK"
                kicker="Straight answers"
                title="Before you trust the librarian."
              />
            </div>
            <div className="v5-faq-list">
              <details>
                <summary>Do I own the memory?</summary>
                <p>
                  Yes. Plain Markdown in your account: GitHub for self-hosted,
                  or GitHub or an app-created Google Drive folder with Hosted.
                </p>
              </details>
              <details>
                <summary>Can every agent use it?</summary>
                <p>
                  Any compatible MCP client can retrieve or contribute context
                  through Zenod.
                </p>
              </details>
              <details>
                <summary>Why one controlled writer?</summary>
                <p>
                  Open reads make memory useful. Gatekept writes keep it
                  organized.
                </p>
              </details>
              <details>
                <summary>What can I send?</summary>
                <p>
                  Text, conversations, voice notes, screenshots, and supported
                  documents.
                </p>
              </details>
              <details>
                <summary>What if I leave Zenod?</summary>
                <p>
                  You keep the complete library. Self-host it. Read it
                  directly. Hire another librarian.
                </p>
              </details>
            </div>
          </div>
        </section>

        <ClosingStorySection />

        <div className="v5-wrap">
          <footer className="v5-footer">
            <div>
              <b>ZENOD</b>
              <span>THE LIBRARIAN FOR YOUR AGENTS</span>
            </div>
            <nav>
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                <BookOpenIcon /> Docs
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubIcon /> GitHub
              </a>
              <a href={PRIVACY_URL}>Privacy</a>
              <a href={TERMS_URL}>Terms</a>
              <a href="/legal/legal-notice.html">Legal notice</a>
              <a href="/legal/cookies.html">Cookies</a>
              <a href={DATA_URL}>Data</a>
            </nav>
          </footer>
        </div>
      </main>
    </div>
  );
}

function PricingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <div className="v5-site v5-pricing-page">
      <SiteHeader customer={customer} />
      <main>
        <section className="v5-pricing-intro">
          <div className="v5-wrap">
            <p className="v5-kicker">Zenod plans</p>
            <h1>Your agents share one library. You decide where it runs.</h1>
            <p className="v5-lead">
              Self-host Zenod free with your AI provider and Telegram, or
              choose Zenod Hosted for €9/month + VAT with managed AI usage and
              WhatsApp included. Self-hosted runs on your server with your AI
              provider key. Hosted manages the service for you. Self-hosted
              uses your GitHub vault; Hosted lets you choose GitHub or an
              app-created Google Drive folder. Either way, your memory is
              ordinary Markdown.
            </p>
          </div>
        </section>
        <PricingSection customer={customer} />
      </main>
    </div>
  );
}

export default function App() {
  const customer = useCustomerJourney();
  return window.location.pathname === "/pricing" ? (
    <PricingPage customer={customer} />
  ) : (
    <LandingPage customer={customer} />
  );
}
