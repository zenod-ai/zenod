// zenod.dev landing, Paper (ZAL-A9 redo of ZAL-A6). Every section shows one
// real product screen first, then names the benefit in plain words. Story, per
// Jordi's brief of 2026-11-04: WhatsApp and code agents as the ways in, then
// ingestion, digestion and retrieval, then owning the library (mining it,
// self-custody); voice first. Iteration 3 brings in the EPIC-12 deck's three
// scenes (WhatsApp, a memory joining the graph, retrieval with strengths), an
// early MCP-from-the-cloud section, and pricing at the end. Every claim must
// hold for production today, and WhatsApp only captures and acknowledges
// (root L-6). The screenshots are rendered by apps/site/shots/capture.mjs with
// demo content; the graph view and lit answer screens (EPIC-18 W4) are the
// shipped web app on the made-up demo vault. EPIC-25 puts five short animated
// moves right after the hero (kept forever, the cloud, helpers, the librarian,
// one memory for every AI); the real screens below prove them. E25-S3 (Jordi,
// vn_101d2c67, 2026-11-18) leads with his words: a self-organizing digital
// memory, voice notes on WhatsApp, every agent over MCP, helpers on your memory.
// Iteration 2 (vn_668d73df): the screenshot sections are gone; the page is the
// hero, seven animated diagrams (five-moves.tsx) and pricing.
import * as React from "react";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@/paper.css";
import "@/scenes.css";
import { useFreeMemories } from "@/lib/testers";

import whatsappScene from "@/scenes/whatsapp.html?raw";
import {
  DASHBOARD_URL,
  GOOGLE_SIGN_IN_PATH,
  type PaidTier,
  SIGN_IN_PATH,
} from "@/lib/customer";
import { FiveMoves } from "@/components/five-moves";
import { SampleMemory } from "@/components/sample-memory";
import { startScenes } from "@/lib/scenes";

const GITHUB_URL = "https://github.com/zenod-ai/zenod";

export interface PaperCustomer {
  signedIn: boolean;
  busyTier: PaidTier | null;
  error: string | null;
  paidSignupReady: boolean;
  // Signed out, Hosted first signs in with the chosen provider, then returns
  // to zenod.dev and opens the live Stripe checkout.
  subscribe: (tier: PaidTier, signInPath?: string) => void;
}

// The deck's scene markup, verbatim. The objects stay constant and the scene
// components are memoised, so a re-render (sign-in state, readiness) never
// resets markup the scene player is animating.
const WHATSAPP_HTML = { __html: whatsappScene };

// `base` is "" on the home page and "/" on other Paper pages, so the section
// links always land on the home page's sections.
// `menu` adds a phone-width Menu with the same links (the /pricing and /connect
// pages kept theirs from ZAL-A13); `getStartedHref` lets /pricing point at its
// own plans.
export function Nav({
  customer,
  base = "",
  menu = false,
  getStartedHref,
  getStartedLabel = "Get started",
}: {
  customer: Pick<PaperCustomer, "signedIn">;
  base?: "" | "/";
  menu?: boolean;
  getStartedHref?: string;
  getStartedLabel?: string;
}) {
  const links = [
    { href: `${base}#how`, label: "How it works" },
    // E25-S5: why Zenod exists, in mini chapters (Jordi, 25 Nov 2026).
    { href: "/vision", label: "Vision" },
    { href: `${base}#mcp`, label: "Your AI tools" },
    { href: `${base}#start`, label: "Pricing" },
    { href: "/connect", label: "Connect" },
    { href: "/testers", label: "Testers" },
  ];
  return (
    <header className="pp-nav">
      <div className="pp-nav-in">
        <a className="pp-brand" href="/" aria-label="Zenod Memory home">
          Zenod
        </a>
        <nav aria-label="Primary">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        {customer.signedIn ? (
          <a className="pp-nav-link" href={DASHBOARD_URL}>
            Dashboard
          </a>
        ) : (
          <a className="pp-nav-link" href={GOOGLE_SIGN_IN_PATH}>
            Sign in
          </a>
        )}
        <a className="pp-btn pp-btn-small" href={getStartedHref ?? `${base}#start`}>
          {getStartedLabel}
        </a>
        {menu ? (
          <details className="pp-menu">
            <summary>Menu</summary>
            <nav aria-label="Menu">
              {links.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          </details>
        ) : null}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="pp-foot">
      <p className="pp-foot-name">
        Zenod is named after Zenodotus, the first librarian of Alexandria.
      </p>
      <p className="pp-foot-links">
        <a href="/vision">Vision</a>
        <a href="/connect">Docs</a>
        <a href="/testers">Testers</a>
        <a href="/zenod-memory">What is Zenod Memory</a>
        <a href="/zenod-vs-basic-memory-mem0">vs Basic Memory and Mem0</a>
        <a href="/zenod-vs-zenodo">Zenod is not Zenodo</a>
        <a href={GITHUB_URL}>GitHub</a>
        <a href="/legal/privacy.html">Privacy</a>
        <a href="/legal/terms.html">Terms</a>
        <a href="/legal/legal-notice.html">Legal notice</a>
        <a href="/legal/cookies.html">Cookies</a>
        <a href="/legal/data-handling.html">Data</a>
      </p>
      <p className="pp-fine pp-foot-note">
        Examples use demo people and notes.
      </p>
    </footer>
  );
}

function Tag({ live, children }: { live: boolean; children: React.ReactNode }) {
  return <span className={live ? "pp-tag pp-tag-live" : "pp-tag pp-tag-soon"}>{children}</span>;
}

export const WhatsappScene = React.memo(function WhatsappScene() {
  return <div className="pp-hero-stage scene" data-len="13500" dangerouslySetInnerHTML={WHATSAPP_HTML} />;
});

// Testers get a personal code (EPIC-7 T4); it goes in Stripe Checkout, which
// accepts promotion codes and asks for no card when the total is €0.
function TesterCodeNote() {
  return (
    <p className="pp-fine pp-plan-note">
      Have a tester code? Enter it at checkout. <a href="/testers">Become a tester</a>
    </p>
  );
}

function HostedAction({ customer }: { customer: PaperCustomer }) {
  if (customer.busyTier === "monthly")
    return (
      <button className="pp-btn pp-btn-primary" disabled>
        Opening checkout…
      </button>
    );
  if (!customer.paidSignupReady)
    return (
      <button className="pp-btn pp-btn-primary" disabled>
        Hosted beta opening soon
      </button>
    );
  if (customer.signedIn)
    return (
      <button className="pp-btn pp-btn-primary" onClick={() => customer.subscribe("monthly")}>
        Choose Hosted
      </button>
    );
  return (
    <>
      <p className="pp-plan-actions">
        <button className="pp-btn pp-btn-primary" onClick={() => customer.subscribe("monthly", GOOGLE_SIGN_IN_PATH)}>
          Start with Google
        </button>
        <button className="pp-btn pp-btn-ghost" onClick={() => customer.subscribe("monthly", SIGN_IN_PATH)}>
          Start with GitHub
        </button>
      </p>
      <p className="pp-fine pp-plan-note">
        Sign in, then pay on Stripe’s secure checkout.
      </p>
    </>
  );
}

function Plans({ customer }: { customer: PaperCustomer }) {
  return (
    <section className="pp-plans-sec" id="start" aria-labelledby="start-title">
      <h2 id="start-title" data-reveal>Free to run yourself. Nine euros a month hosted.</h2>
      <div className="pp-plans">
        <div className="pp-plan" data-reveal>
          <h3>Self-hosted</h3>
          <p className="pp-price">Free</p>
          <p>
            Run Zenod on your own server with your AI provider key, a Telegram
            bot and a GitHub repository for your library.
          </p>
          <a className="pp-btn" href={`${GITHUB_URL}#readme`}>
            Read the install guide
          </a>
        </div>
        <div className="pp-plan pp-plan-hosted" data-reveal>
          <h3>Zenod Hosted</h3>
          <p className="pp-price">
            €9 <small>per month + VAT</small>
          </p>
          <p>
            We run it for you. Managed AI usage and WhatsApp are included. Keep
            your library in GitHub or in a Google Drive folder the app creates.
          </p>
          <HostedAction customer={customer} />
          <TesterCodeNote />
        </div>
      </div>
      {customer.error ? (
        <p className="pp-fine pp-error">{customer.error}. Please retry.</p>
      ) : null}
      <p className="pp-fine">
        Self-host Zenod free with your AI provider and Telegram. Zenod Hosted is
        €9/month + VAT with managed AI usage and WhatsApp included. Same
        open-source engine in both, and your memory is ordinary Markdown either
        way. <a href="/pricing">Plan details</a>
      </p>
    </section>
  );
}

function useReveal() {
  React.useEffect(() => {
    const root = document.documentElement;
    const items = [...document.querySelectorAll<HTMLElement>(".pp [data-reveal]")];
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("pp-js");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("pp-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const item of items) observer.observe(item);
    return () => {
      observer.disconnect();
      root.classList.remove("pp-js");
    };
  }, []);
}

function useScenes() {
  React.useEffect(() => startScenes(document), []);
}

export function PaperLanding({ customer }: { customer: PaperCustomer }) {
  const freeMemories = useFreeMemories();
  useReveal();
  useScenes();
  return (
    <div className="pp">
      <Nav customer={customer} menu />
      <main id="top">
        <section className="pp-hero" aria-labelledby="hero-title">
          <div className="pp-hero-text">
            <h1 id="hero-title">
              <span className="pp-h1-name">Zenod Memory</span>{" "}
              <span className="pp-line"><span>A digital memory</span></span>{" "}
              <span className="pp-line"><span>that organizes itself.</span></span>
            </h1>
            <p className="pp-lead">
              Just send voice notes on WhatsApp. Zenod transcribes each one,
              files it on the right page and links it to what you said before,
              as plain Markdown in your own Google Drive or GitHub.
            </p>
            <p className="pp-lead">
              Connect all your agents to it over MCP: Claude, ChatGPT, Cursor
              and the rest read from it and save to it. Then send helpers into
              it, to remind you of loose ends, bring back ideas and notice
              patterns you missed.
            </p>
            <p className="pp-actions">
              <a className="pp-btn pp-btn-primary" href="#start">
                Get started
              </a>
              <a className="pp-btn" href="/connect">
                Connect your AI tool
              </a>
            </p>
            {/* EPIC-7 T13: phone visitors had no way to the tester page above the footer. */}
            <p className="pp-fine pp-hero-testers">
              We are letting in our first ten testers: your first{" "}
              {freeMemories} memories free, no card.{" "}
              <a href="/testers">Become a tester</a>
            </p>
          </div>
          <figure className="pp-hero-shot">
            <WhatsappScene />
            <figcaption>
              <Tag live>Live</Tag> A voice note to Zenod on WhatsApp and its two
              replies, word for word, with demo content.
            </figcaption>
          </figure>
        </section>

        {/* E26-S37: Zenod at work in the first screens (the same sample as /testers), one way on to apply. */}
        <div className="pp-home-sample">
          <SampleMemory wayOn={{ href: "/testers", label: "Become a tester and try it with your voice notes" }} />
        </div>

        <FiveMoves />

        <Plans customer={customer} />
      </main>
      <Footer />
    </div>
  );
}
