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
// shipped web app on the made-up demo vault.
import * as React from "react";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@/paper.css";
import "@/scenes.css";

import whatsappScene from "@/scenes/whatsapp.html?raw";
import retrievalScreen from "@/scenes/retrieval-screen.html?raw";
import retrievalResults from "@/scenes/retrieval-results.html?raw";
import constellationScene from "@/scenes/constellation.html?raw";
import log from "@/assets/shots/log.webp";
import logPhone from "@/assets/shots/log-phone.webp";
import page from "@/assets/shots/page.webp";
import pagePhone from "@/assets/shots/page-phone.webp";
import learn from "@/assets/shots/learn.webp";
import learnPhone from "@/assets/shots/learn-phone.webp";
import recall from "@/assets/shots/recall.webp";
import recallPhone from "@/assets/shots/recall-phone.webp";
import history from "@/assets/shots/history.webp";
import historyPhone from "@/assets/shots/history-phone.webp";
import consoleShot from "@/assets/shots/console.webp";
import consolePhone from "@/assets/shots/console-phone.webp";
import graphLive from "@/assets/shots/graph-live.webp";
import graphLivePhone from "@/assets/shots/graph-live-phone.webp";
import lit from "@/assets/shots/lit.webp";
import litPhone from "@/assets/shots/lit-phone.webp";
import {
  DASHBOARD_URL,
  GOOGLE_SIGN_IN_PATH,
  type PaidTier,
  SIGN_IN_PATH,
} from "@/lib/customer";
import { MCP_SERVER_URL } from "@/lib/connect";
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

const AI_TOOLS = ["Claude", "ChatGPT", "Cursor", "VS Code", "Gemini CLI"];

// The deck's scene markup, verbatim. The objects stay constant and the scene
// components are memoised, so a re-render (sign-in state, readiness) never
// resets markup the scene player is animating.
const WHATSAPP_HTML = { __html: whatsappScene };
const RETRIEVAL_SCREEN_HTML = { __html: retrievalScreen };
const RETRIEVAL_RESULTS_HTML = { __html: retrievalResults };
const CONSTELLATION_HTML = { __html: constellationScene };

// The constellation walk (EPIC-18 W2): what stays above 80% when strengths
// multiply along each path, in the order the scene lights it, and what fades.
const CONSTELLATION_KEPT = [
  { name: "Leo", sum: "1", at: 4800 },
  { name: "Saturday morning", sum: "1 × 0.9 = 0.9", at: 5500 },
  { name: "Ana’s drill", sum: "1 × 0.9 × 0.9 = 0.81", at: 6200 },
  { name: "Garden shed", sum: "0.9", at: 6900 },
  { name: "Cedar boards", sum: "1 × 0.9 × 0.95 = 0.855", at: 7600 },
];

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
}: {
  customer: Pick<PaperCustomer, "signedIn">;
  base?: "" | "/";
  menu?: boolean;
  getStartedHref?: string;
}) {
  const links = [
    { href: `${base}#how`, label: "How it works" },
    { href: `${base}#mcp`, label: "Your AI tools" },
    { href: `${base}#start`, label: "Pricing" },
    { href: "/connect", label: "Connect" },
    { href: "/testers", label: "Testers" },
  ];
  return (
    <header className="pp-nav">
      <div className="pp-nav-in">
        <a className="pp-brand" href="/" aria-label="Zenod home">
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
          Get started
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
        <a href="/connect">Docs</a>
        <a href="/testers">Testers</a>
        <a href={GITHUB_URL}>GitHub</a>
        <a href="/legal/privacy.html">Privacy</a>
        <a href="/legal/terms.html">Terms</a>
        <a href="/legal/legal-notice.html">Legal notice</a>
        <a href="/legal/cookies.html">Cookies</a>
        <a href="/legal/data-handling.html">Data</a>
      </p>
      <p className="pp-fine pp-foot-note">
        Screens show the real product with demo people and notes.
      </p>
    </footer>
  );
}

interface ShotProps {
  src: string;
  width: number;
  height: number;
  // The same screen reflowed at phone width, so its text stays readable.
  phone: { src: string; width: number; height: number };
  alt: string;
  caption: string;
}

function Shot({ src, width, height, phone, alt }: ShotProps) {
  return (
    <div className="pp-shot pp-stage" data-reveal>
      <picture>
        <source media="(max-width: 560px)" srcSet={phone.src} width={phone.width} height={phone.height} />
        <img src={src} width={width} height={height} loading="lazy" alt={alt} />
      </picture>
    </div>
  );
}

interface ShowcaseProps {
  id: string;
  title: string;
  shot: ShotProps;
  layout: "left" | "right" | "wide";
  children: React.ReactNode;
}

function Tag({ live, children }: { live: boolean; children: React.ReactNode }) {
  return <span className={live ? "pp-tag pp-tag-live" : "pp-tag pp-tag-soon"}>{children}</span>;
}

// Zenod runs in the cloud at one MCP address; any connected AI tool reaches
// the same library. The figure draws the path once it is on screen.
const WhatsappScene = React.memo(function WhatsappScene() {
  return <div className="pp-hero-stage scene" data-len="13500" dangerouslySetInnerHTML={WHATSAPP_HTML} />;
});

const McpSection = React.memo(function McpSection() {
  return (
    <section className="pp-mcp" id="mcp" aria-labelledby="mcp-title">
      <div className="pp-mcp-say" data-reveal>
        <h2 id="mcp-title">Your AI tools reach it over MCP, from the cloud.</h2>
        <p>
          Zenod runs in the cloud at one address. Add it once as a connector
          and Claude, ChatGPT, Cursor, VS Code or Gemini CLI can search your
          memory, open a note and save what you worked out, from any computer.
          There is nothing to host or keep running.
        </p>
        <p className="pp-actions">
          <a className="pp-btn pp-btn-primary" href="/connect">
            Connect your AI tool
          </a>
        </p>
        <p className="pp-fine">
          Listed in the official MCP Registry as dev.zenod/memory. Your tool
          asks you to sign in to Zenod once, with Google or GitHub.
        </p>
      </div>
      <figure className="pp-mcp-fig">
        <div
          className="pp-mcp-stage scene"
          data-len="9000"
          role="img"
          aria-label="Claude, ChatGPT, Cursor, VS Code and Gemini CLI connect over MCP to Zenod at cloud.zenod.dev/mcp, which reads and writes your library of Markdown files in GitHub or Google Drive"
        >
          <ul className="pp-mcp-tools">
            {AI_TOOLS.map((tool, index) => (
              <li key={tool} className="st" data-at={300 + index * 220}>
                {tool}
              </li>
            ))}
          </ul>
          <div className="pp-wire st" data-at="1600">
            <span>MCP</span>
          </div>
          <div className="pp-hub st" data-at="2000">
            <b>Zenod</b>
            <span>
              {MCP_SERVER_URL.replace("https://", "").replace("/mcp", "")}
              <wbr />
              /mcp
            </span>
          </div>
          <div className="pp-wire st" data-at="2600">
            <span>Markdown</span>
          </div>
          <div className="pp-vault st" data-at="3000">
            <b>Your library</b>
            <span>GitHub or Google Drive</span>
          </div>
        </div>
        <figcaption>
          <Tag live>Live</Tag> One connector address for every tool.
        </figcaption>
      </figure>
    </section>
  );
});

// A memory joining the graph: filing and the graph view are both live (E12-S2),
// the lines drawn by link strength (E18-W1). A real screen, demo memories.
const GraphSection = React.memo(function GraphSection() {
  return (
    <section className="pp-wide" id="graph" aria-labelledby="graph-title">
      <div className="pp-wide-head" data-reveal>
        <p className="pp-tags">
          <Tag live>Live</Tag> filing <Tag live>Live</Tag> the graph view
        </p>
        <h2 id="graph-title">Every memory finds its place, and its links.</h2>
        <p>
          The voice note above lands on the two pages its receipt names, and
          Zenod finds your topics by itself. The Graph tab in the app shows it
          as a graph you can walk, from each topic to the moment you said it.
          The stronger the link, the darker its line.
        </p>
      </div>
      <figure className="pp-real" data-reveal>
        <picture>
          <source media="(max-width: 560px)" srcSet={graphLivePhone} width={716} height={1034} />
          <img
            src={graphLive}
            width={1272}
            height={1114}
            loading="lazy"
            alt="The Zenod graph view: one memory in the middle, its topic above, and lines to linked memories drawn strong, medium or weak."
          />
        </picture>
        <figcaption className="pp-fine">Live. The graph view in the Zenod app today, with demo memories.</figcaption>
      </figure>
    </section>
  );
});

// One thought as a constellation of weighted links, then a retrieval at 80%
// that follows the strong paths (EPIC-18 W2). Live since e7840bf: weighted
// links and path retrieval rank the app's answers and the memory_cloud tool.
const ConstellationSection = React.memo(function ConstellationSection() {
  return (
    <section className="pp-cst scene" id="constellation" data-len="14000" aria-labelledby="constellation-title">
      <div className="pp-cst-stage">
        <p className="pp-cst-pill st" data-at="3600">Bring back what stays above 80%</p>
        <div dangerouslySetInnerHTML={CONSTELLATION_HTML} />
      </div>
      <div className="pp-say">
        <p className="pp-tags">
          <Tag live>Live</Tag>
        </p>
        <h2 id="constellation-title">Every thought links to others, and each link has a strength.</h2>
        <p>
          Zenod is a librarian that keeps an index of your memory and connects
          it. A voice note filed on a page is a strong link. A passing mention
          is a faint one.
        </p>
        <p>
          When you ask, Zenod follows the links from the best match and
          multiplies their strengths along the way. Whatever stays above 80%
          comes back, even three steps away, so the strong paths bring back
          what matters without reading everything.
        </p>
        <ol className="pp-cst-walk">
          {CONSTELLATION_KEPT.map((row) => (
            <li key={row.name} className="st" data-at={row.at}>
              <span>{row.name}</span>
              <span>{row.sum}</span>
            </li>
          ))}
        </ol>
        <p className="pp-cst-out st" data-at="7900">
          Left out, below 0.8: Timber yard receipt 0.77, Home 0.68, Leo’s
          birthday 0.6, Lisbon trip 0.3, Weather forecast 0.05.
        </p>
        <p className="pp-fine">
          Live. Answers in the Zenod app are ranked this way today, and
          connected AI tools can ask for the cloud around any memory. Strengths
          come from how each note was filed and linked. Demo memories.
        </p>
      </div>
    </section>
  );
});

// Retrieval with strengths: percentages are live in the app's chat and graph
// (E12-S3a, S13) and in search over MCP; the real lit answer follows the scene.
const StrengthSection = React.memo(function StrengthSection() {
  return (
    <section className="pp-strength scene" id="strength" data-len="11500" aria-labelledby="strength-title">
      <div className="app" dangerouslySetInnerHTML={RETRIEVAL_SCREEN_HTML} />
      <div className="pp-say">
        <p className="pp-tags">
          <Tag live>Live</Tag>
        </p>
        <h2 id="strength-title">Ask, and see how strongly each memory answers.</h2>
        <div dangerouslySetInnerHTML={RETRIEVAL_RESULTS_HTML} />
        <p className="pp-fine">
          Live. Each answer in the app lists the memories it used with their
          match, and Show in graph lights them up. Claude, ChatGPT or Cursor
          get the same percentage over MCP. It is how well each memory matches
          against the best one, not a probability. Demo memories.
        </p>
      </div>
      <figure className="pp-real pp-real-full" data-reveal>
        <picture>
          <source media="(max-width: 560px)" srcSet={litPhone} width={716} height={1744} />
          <img
            src={lit}
            width={1952}
            height={1214}
            loading="lazy"
            alt="An answer lit up in the Zenod graph: the five memories it used in green with their percentages, and the list beside it from 100% to 92%."
          />
        </picture>
        <figcaption className="pp-fine">Live. An answer lit up in the Zenod app today, with demo memories.</figcaption>
      </figure>
    </section>
  );
});

// Show it, then name it: the screenshot comes first, the benefit follows.
function Showcase({ id, title, shot, layout, children }: ShowcaseProps) {
  return (
    <section className={`pp-show pp-show-${layout}`} id={id} aria-labelledby={`${id}-title`}>
      <Shot {...shot} />
      <div className="pp-say" data-reveal>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
        <p className="pp-fine pp-cap">{shot.caption}</p>
      </div>
    </section>
  );
}

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
  useReveal();
  useScenes();
  return (
    <div className="pp">
      <Nav customer={customer} />
      <main id="top">
        <section className="pp-hero" aria-labelledby="hero-title">
          <div className="pp-hero-text">
            <h1 id="hero-title">
              <span className="pp-line"><span>Hire a librarian</span></span>{" "}
              <span className="pp-line"><span>for your memory.</span></span>
            </h1>
            <p className="pp-lead">
              Send Zenod a voice note on WhatsApp, or ask Claude, ChatGPT or
              Cursor to save what you just worked out: they connect to Zenod
              over MCP, from the cloud. Zenod transcribes it, files it and
              keeps it as plain Markdown in your own GitHub or Google Drive.
            </p>
            <p className="pp-actions">
              <a className="pp-btn pp-btn-primary" href="#start">
                Get started
              </a>
              <a className="pp-btn" href="/connect">
                Connect your AI tool
              </a>
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

        <McpSection />

        <div id="how" className="pp-how">
          <Showcase
            id="kept"
            layout="left"
            title="Kept exactly as you said it."
            shot={{
              src: log,
              phone: { src: logPhone, width: 760, height: 1968 },
              width: 1840,
              height: 1518,
              alt: "A GitHub file view of Log/2026-11-04.md: three dated entries, a photo, a note from an AI assistant and the voice note, each with its source and the words quoted unchanged",
              caption: "The day’s log in your GitHub repository, with the voice note at the bottom.",
            }}
          >
            <p>
              Every voice note, photo and message lands first in a dated log,
              word for word, and WhatsApp recordings are archived to your Google
              Drive. Zenod writes each entry once and never edits it, so the
              original is always there to check.
            </p>
          </Showcase>

          <Showcase
            id="filed"
            layout="right"
            title="Filed on the right page."
            shot={{
              src: page,
              phone: { src: pagePhone, width: 760, height: 1192 },
              width: 2080,
              height: 1000,
              alt: "The Garden shed project page open in Obsidian, with its properties and four lines, each ending in a link to the log entry it came from",
              caption: "The page the voice note was filed on, opened in Obsidian.",
            }}
          >
            <p>
              Zenod reads what came in and updates the projects and topics it
              touches. Every line links back to the moment you said it, so you
              can check any summary against your own words.
            </p>
          </Showcase>
          <GraphSection />
          <ConstellationSection />
        </div>

        <div className="pp-agents">
          <Showcase
            id="save"
            layout="left"
            title="Save a lesson from your editor."
            shot={{
              src: learn,
              phone: { src: learnPhone, width: 760, height: 1574 },
              width: 1880,
              height: 1052,
              alt: "Claude Code in a terminal calling the Zenod store_memory tool with a database learning, then get_task_result, which answers Saved with the log entry and the page it was filed on",
              caption: "Claude Code saving a learning through Zenod’s MCP tools.",
            }}
          >
            <p>
              When you and Claude Code, Cursor or VS Code work something out,
              ask it to save the lesson. It goes into the same library as your
              voice notes, filed the same way.
            </p>
          </Showcase>

          <Showcase
            id="ask"
            layout="right"
            title="Ask, and see the source."
            shot={{
              src: recall,
              phone: { src: recallPhone, width: 760, height: 1592 },
              width: 1880,
              height: 1070,
              alt: "Claude Code calling the Zenod search_memory tool for the newest WhatsApp voice note, then get_memory, which returns the full transcript, then answering from it",
              caption: "Claude Code finding this morning’s voice note and reading its transcript.",
            }}
          >
            <p>
              Any connected agent can search your library and read the exact
              entry behind its answer, down to the transcript of this
              morning’s voice note.
            </p>
            <p className="pp-fine">
              Questions go through a connected agent such as Claude, ChatGPT or
              Cursor. <a href="/connect">How to connect</a>
            </p>
          </Showcase>
        </div>

        <StrengthSection />

        <Showcase
          id="yours"
          layout="left"
          title="The library is yours."
          shot={{
            src: history,
            phone: { src: historyPhone, width: 760, height: 1358 },
            width: 1840,
            height: 1298,
            alt: "The commit history of a private GitHub repository called memory: commits from zenod-bot for each capture and filing, and one from the owner made in Obsidian",
            caption: "Every change Zenod makes is a commit in your repository.",
          }}
        >
          <p>
            Your memory is plain Markdown in a GitHub repository or Google Drive
            folder you own, with every change kept in its history. Open it in
            Obsidian, dig through years of notes with any tool, or stop using
            Zenod and keep every file.
          </p>
        </Showcase>

        <Showcase
          id="console"
          layout="right"
          title="Everything on one page."
          shot={{
            src: consoleShot,
            phone: { src: consolePhone, width: 780, height: 1010 },
            width: 1560,
            height: 1600,
            alt: "The Zenod console overview: MCP, vault and channel cards, included usage at 18 percent, and the latest save, a WhatsApp voice note filed on the Garden shed page",
            caption: "The Zenod console overview.",
          }}
        >
          <p>
            Connect WhatsApp, choose where your library lives, and see what you
            saved lately and how much of the month’s usage is left.
          </p>
        </Showcase>

        <Plans customer={customer} />
      </main>
      <Footer />
    </div>
  );
}
