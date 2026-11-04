// zenod.dev landing, direction A "Paper" (ZAL-A6). Story, per Jordi's brief of
// 2026-11-04: WhatsApp and code agents as the ways in, then ingestion,
// digestion and retrieval, then owning the library (mining it, self-custody).
// Voice notes get their own chapter. Every claim must hold for production today.
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@/paper.css";

import hero from "@/assets/paper/hero.webp";
import voice from "@/assets/paper/voice.webp";
import hall from "@/assets/paper/hall.webp";
import {
  CustodyDiagram,
  LayersDiagram,
  WaysInDiagram,
} from "@/components/paper-diagrams";
import {
  ConsoleShots,
  LearningShot,
  RecallShot,
  WhatsAppVoiceShot,
} from "@/components/product-shots";
import {
  DASHBOARD_URL,
  GOOGLE_SIGN_IN_PATH,
  type PaidTier,
} from "@/lib/customer";

const GITHUB_URL = "https://github.com/zenod-ai/zenod";

export interface PaperCustomer {
  signedIn: boolean;
  busyTier: PaidTier | null;
  error: string | null;
  paidSignupReady: boolean;
  subscribe: (tier: PaidTier) => void;
}

function Nav({ customer }: { customer: PaperCustomer }) {
  return (
    <header className="pp-nav">
      <div className="pp-nav-in">
        <a className="pp-brand" href="/" aria-label="Zenod home">
          Zenod
        </a>
        <nav aria-label="Primary">
          <a href="#ways-in">How it works</a>
          <a href="#voice">Voice</a>
          <a href="#yours">Your library</a>
          <a href="#start">Pricing</a>
          <a href="/connect">Connect</a>
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
        <a className="pp-btn pp-btn-small" href="#start">
          Get started
        </a>
      </div>
    </header>
  );
}

function Plans({ customer }: { customer: PaperCustomer }) {
  return (
    <section className="pp-sec pp-wrap" id="start" aria-labelledby="start-title">
      <h2 id="start-title">Run it your way.</h2>
      <div className="pp-plans">
        <div className="pp-plan">
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
        <div className="pp-plan">
          <h3>Zenod Hosted</h3>
          <p className="pp-price">
            €9 <small>per month + VAT</small>
          </p>
          <p>
            We run it for you. Managed AI usage and WhatsApp are included. Keep
            your library in GitHub or in a Google Drive folder the app creates.
          </p>
          <button
            className="pp-btn pp-btn-primary"
            disabled={customer.busyTier !== null || !customer.paidSignupReady}
            onClick={() => customer.subscribe("monthly")}
          >
            {customer.busyTier === "monthly"
              ? "Opening checkout…"
              : customer.paidSignupReady
                ? "Choose Hosted"
                : "Hosted beta opening soon"}
          </button>
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

export function PaperLanding({ customer }: { customer: PaperCustomer }) {
  return (
    <div className="pp">
      <Nav customer={customer} />
      <main id="top">
        <section className="pp-hero pp-wrap">
          <h1>Hire a librarian for your memory.</h1>
          <p className="pp-lead">
            Talk to Zenod on WhatsApp, or plug it into Claude Code and Cursor.
            It transcribes, files and keeps what you send in a library of plain
            Markdown that lives in your own GitHub or Google Drive.
          </p>
          <p className="pp-actions">
            <a className="pp-btn pp-btn-primary" href="#start">
              Try Zenod free
            </a>
            <a className="pp-btn" href={GITHUB_URL}>
              Star on GitHub
            </a>
          </p>
        </section>
        <figure className="pp-band">
          <img
            src={hero}
            width={1536}
            height={1024}
            alt="Wooden library shelves holding paper scrolls and books in warm window light"
          />
        </figure>

        <section className="pp-sec pp-wrap" id="ways-in" aria-labelledby="ways-in-title">
          <h2 id="ways-in-title">Two ways in.</h2>
          <p>
            Most of what you want to remember starts in one of two places: your
            phone, or the agent you are working with. Zenod sits behind both.
          </p>
          <p>
            On your phone it is a WhatsApp contact. Send it a voice note, a
            photo, a document or a quick line of text. At your desk it is an MCP
            server, so Claude Code, Cursor, VS Code, ChatGPT and Gemini CLI can
            save to your memory and look things up in it while you work.
          </p>
          <WaysInDiagram />
          <p className="pp-fine">
            WhatsApp comes with Hosted. Self-hosted uses Telegram.{" "}
            <a href="/connect">How to connect an agent</a>
          </p>
        </section>

        <section className="pp-sec pp-wrap" id="voice" aria-labelledby="voice-title">
          <h2 id="voice-title">Made for voice notes.</h2>
          <p>
            Most thoughts never get typed. They turn up while you walk, drive or
            cook. Hold the mic in WhatsApp and say it the way you would to a
            friend, in ten seconds or in a long ramble.
          </p>
          <p>
            Zenod transcribes the note, keeps the recording next to the
            transcript and files what you said onto the pages it belongs to. It
            replies when the note arrives, and again once it has been filed.
          </p>
          <WhatsAppVoiceShot />
        </section>
        <figure className="pp-band">
          <img
            src={voice}
            width={1536}
            height={1024}
            loading="lazy"
            alt="A phone, a ceramic cup and a blank sheet of paper on an oak desk"
          />
        </figure>

        <section className="pp-sec pp-wrap" id="desk" aria-labelledby="desk-title">
          <h2 id="desk-title">And from your editor.</h2>
          <p>
            When you and your coding agent work something out, tell it to save
            the lesson. It calls Zenod’s store_memory tool, and Zenod files the
            learning in the same library as your voice notes.
          </p>
          <LearningShot />
        </section>

        <section className="pp-sec pp-wrap" id="ingestion" aria-labelledby="ingestion-title">
          <h2 id="ingestion-title"><span className="pp-h-step">Ingestion.</span> Kept as it arrived.</h2>
          <p>
            Everything you send is saved first, exactly as it came in: the
            recording, the photo, the PDF, your words. Zenod writes these
            originals once and never edits them again. They are the evidence
            that every later note points back to.
          </p>
        </section>

        <section className="pp-sec pp-wrap" id="digestion" aria-labelledby="digestion-title">
          <h2 id="digestion-title"><span className="pp-h-step">Digestion.</span> Filed where it belongs.</h2>
          <p>
            Then Zenod reads what came in and updates the pages it touches: a
            project, a person, a preference, a date to remember. Each line it
            writes links to the original it came from, so you can check any
            summary against what you actually said.
          </p>
          <LayersDiagram />
        </section>

        <section className="pp-sec pp-wrap" id="retrieval" aria-labelledby="retrieval-title">
          <h2 id="retrieval-title"><span className="pp-h-step">Retrieval.</span> Ask, and see the source.</h2>
          <p>
            Ask your agent “When does my passport expire?” or “What did I say
            about the light in that flat?” Zenod searches your library, answers
            from your own pages and names the pages it used. Follow the link and
            you are back at the voice note.
          </p>
          <RecallShot />
          <p className="pp-fine">
            Questions go through a connected agent such as Claude, ChatGPT or
            Cursor. <a href="/connect">How to connect</a>
          </p>
        </section>

        <section className="pp-sec pp-wrap" id="yours" aria-labelledby="yours-title">
          <h2 id="yours-title">The library stays in your hands.</h2>
          <p>
            Your memory is plain Markdown in a GitHub repository you own or, on
            Hosted, a Google Drive folder in your account. Zenod is the
            librarian you hire to keep it in order. The shelves are yours.
          </p>
          <p>
            Every change is a git commit, so you can see what was written and
            when. Open the folder in Obsidian, copy it, back it
            up. If you stop using Zenod, the files stay where they are.
          </p>
          <CustodyDiagram />
        </section>

        <section className="pp-sec pp-wrap" id="console" aria-labelledby="console-title">
          <h2 id="console-title">One page for your settings.</h2>
          <p>
            Connect your WhatsApp number, pick where your library lives and see
            what you have used this month, all in the Zenod console.
          </p>
          <ConsoleShots />
        </section>

        <section className="pp-sec pp-wrap" id="mine" aria-labelledby="mine-title">
          <h2 id="mine-title">Years of notes you can dig into.</h2>
          <p>
            A year of voice notes is a record of how you think. Because it sits
            in plain files you control, you can put it to work: ask an agent
            what you kept putting off last spring, which names come up around a
            project, or how your view of a house changed over six visits. Any
            tool that reads text can read it, including ones nobody has built
            yet.
          </p>
        </section>

        <section className="pp-sec pp-wrap" id="name" aria-labelledby="name-title">
          <h2 id="name-title">Why the name.</h2>
          <p>
            Zenodotus was the first librarian of the Library of Alexandria. The
            library was the place. The librarian made it usable.
          </p>
        </section>
        <figure className="pp-band">
          <img
            src={hall}
            width={1536}
            height={1024}
            loading="lazy"
            alt="A quiet library hall with tall arches and a reader at a long table"
          />
        </figure>

        <Plans customer={customer} />
      </main>
      <footer className="pp-foot">
        <div className="pp-foot-in">
          <p className="pp-foot-name">Zenod, the librarian for your memory.</p>
          <p className="pp-foot-links">
            <a href="/connect">Docs</a>
            <a href={GITHUB_URL}>GitHub</a>
            <a href="/legal/privacy.html">Privacy</a>
            <a href="/legal/terms.html">Terms</a>
            <a href="/legal/legal-notice.html">Legal notice</a>
            <a href="/legal/cookies.html">Cookies</a>
            <a href="/legal/data-handling.html">Data</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
