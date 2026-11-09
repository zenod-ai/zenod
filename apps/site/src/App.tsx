import * as React from "react";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Footer, Nav, PaperLanding } from "@/components/paper-landing";
import { TestersPage } from "@/components/testers-page";
import { ConnectPage } from "@/components/connect-page";
import { NotFoundPage } from "@/components/not-found-page";
import {
  consumePendingHostedTier,
  createHostedCheckout,
  DOCS_URL,
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
  subscribe: (tier: PaidTier, signInPath?: string) => void;
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
    (tier: PaidTier, signInPath: string = SIGN_IN_PATH) => {
      if (loading || !session) {
        window.sessionStorage.setItem(PENDING_TIER_KEY, tier);
        window.location.assign(signInPath);
        return;
      }
      void beginCheckout(tier);
    },
    [beginCheckout, loading, session],
  );

  return { session, loading, busyTier, error, paidSignupReady, subscribe };
}

// /pricing and /connect wear the home page's header (ZAL-A17): the Paper bar
// with the Newsreader Z wordmark, its section links landing on the home page,
// Sign in always visible and, below 900 wide, a Menu with the same links.
// Their content keeps the old layout on a Paper ground until the restyle
// Jordi parked (A7, A11).
function PaperBar({
  customer,
  getStartedHref = "/pricing",
}: {
  customer: CustomerJourney;
  getStartedHref?: string;
}) {
  return (
    <div className="pp pp-bar">
      <Nav
        customer={{ signedIn: Boolean(customer.session) }}
        base="/"
        menu
        getStartedHref={getStartedHref}
      />
    </div>
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

// Choose Hosted offers both sign-ins, like the home page, and says where a
// tester code goes: Stripe Checkout, after sign-in.
function HostedPlanAction({ customer }: { customer: CustomerJourney }) {
  if (customer.busyTier === "monthly")
    return (
      <button className="v5-button v5-button-primary" disabled>
        Opening checkout… <ArrowUpRightIcon />
      </button>
    );
  if (!customer.paidSignupReady)
    return (
      <button className="v5-button v5-button-primary" disabled>
        Hosted beta opening soon <ArrowUpRightIcon />
      </button>
    );
  return (
    <>
      {customer.session ? (
        <button
          className="v5-button v5-button-primary"
          onClick={() => customer.subscribe("monthly")}
        >
          Choose Hosted <ArrowUpRightIcon />
        </button>
      ) : (
        <div className="v5-plan-actions">
          <button
            className="v5-button v5-button-primary"
            onClick={() => customer.subscribe("monthly", GOOGLE_SIGN_IN_PATH)}
          >
            Start with Google <ArrowUpRightIcon />
          </button>
          <button
            className="v5-button"
            onClick={() => customer.subscribe("monthly", SIGN_IN_PATH)}
          >
            <GithubIcon /> Start with GitHub
          </button>
        </div>
      )}
      <p className="v5-tester-note">
        Have a tester code? Enter it at Stripe checkout after you sign in.{" "}
        <a href="/testers">Become a tester</a>
      </p>
    </>
  );
}

function PricingSection({ customer }: { customer: CustomerJourney }) {
  return (
    <section className="v5-section" id="start">
      <SectionTitle
        no="06 / START"
        kicker="Choose where it runs"
        title="Start free. Stay in control."
        lead="One library. Two ways to run it."
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
              <HostedPlanAction customer={customer} />
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
        Self-host Zenod free with your AI provider and Telegram. Zenod Hosted is
        €9/month + VAT with managed AI usage and WhatsApp included.
        Hosted: GitHub or Drive · self-hosted: GitHub.
      </p>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="v5-footer">
      <div>
        <b>ZENOD</b>
        <span>THE LIBRARIAN FOR YOUR AGENTS</span>
      </div>
      <nav>
        <a href={DOCS_URL}>
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
  );
}

function LandingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <PaperLanding
      customer={{
        signedIn: Boolean(customer.session),
        busyTier: customer.busyTier,
        error: customer.error,
        paidSignupReady: customer.paidSignupReady,
        subscribe: customer.subscribe,
      }}
    />
  );
}

function PricingPage({ customer }: { customer: CustomerJourney }) {
  return (
    <div className="v5-site v5-paper v5-pricing-page">
      <PaperBar customer={customer} getStartedHref="#start" />
      <main className="v5-wrap">
        <section className="v5-pricing-intro">
          <p className="v5-kicker">Zenod plans</p>
          <h1>Your agents share one library. You decide where it runs.</h1>
          <p className="v5-lead">
            Self-host Zenod free with your AI provider and Telegram, or choose
            Zenod Hosted for €9/month + VAT with managed AI usage and WhatsApp
            included. Self-hosted runs on your server with your AI provider key.
            Hosted manages the service for you. Self-hosted uses your GitHub
            vault; Hosted lets you choose GitHub or an app-created Google Drive
            folder. Either way, your memory is ordinary Markdown.
          </p>
        </section>
        <PricingSection customer={customer} />
      </main>
    </div>
  );
}

export default function App() {
  // ZAL-A19: 404.html marks itself; the server sends it with HTTP 404.
  if (typeof document !== "undefined" && document.body.dataset.page === "not-found") return <NotFoundPage />;
  return <SiteApp />;
}

function SiteApp() {
  const customer = useCustomerJourney();
  const path = window.location.pathname;
  if (path === "/pricing") return <PricingPage customer={customer} />;
  if (path === "/testers")
    return (
      <TestersPage
        nav={<Nav customer={{ signedIn: Boolean(customer.session) }} base="/" />}
        footer={<Footer />}
      />
    );
  if (path === "/connect")
    return (
      <ConnectPage
        header={<PaperBar customer={customer} />}
        footer={<SiteFooter />}
      />
    );
  return <LandingPage customer={customer} />;
}
