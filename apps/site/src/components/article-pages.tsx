/* eslint-disable react-refresh/only-export-components */
// E7-S42: three pages that answer what people type into Google about us (the
// E7-S41 plan, step 4a): what Zenod Memory is, how it differs from Basic Memory
// and Mem0, and that Zenod is not CERN's Zenodo. Each opens with its one-line
// answer and one picture (a flow, or two sides compared), then short sections.
// Facts about other products are only what their own sites and repositories
// say (read 26 Nov 2026); no prices of theirs, no claims we cannot check.
import * as React from "react";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@/paper.css";
import "@/article.css";

export type ArticlePath = "/zenod-memory" | "/zenod-vs-basic-memory-mem0" | "/zenod-vs-zenodo";

export const ARTICLE_LINKS: { href: ArticlePath; label: string }[] = [
  { href: "/zenod-memory", label: "What is Zenod Memory" },
  { href: "/zenod-vs-basic-memory-mem0", label: "Zenod Memory vs Basic Memory and Mem0" },
  { href: "/zenod-vs-zenodo", label: "Zenod is not Zenodo" },
];

function Flow({ steps, label }: { steps: { title: string; text: string }[]; label: string }) {
  return (
    <ol className="za-flow" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step.title}>
          <span className="za-flow-no">{String(i + 1).padStart(2, "0")}</span>
          <b>{step.title}</b>
          <span>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

interface Row {
  label: string;
  cells: string[];
}

function Compare({ heads, rows, caption, ours = 0 }: { heads: string[]; rows: Row[]; caption: string; ours?: number }) {
  return (
    <div className="za-compare-wrap">
      <table className="za-compare">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="za-sr">Question</span>
            </th>
            {heads.map((head, i) => (
              <th key={head} scope="col" className={i === ours ? "za-ours" : undefined}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td key={i} data-head={heads[i]} className={i === ours ? "za-ours" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="za-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

function Shell({
  kicker,
  title,
  answer,
  picture,
  children,
  current,
  nav,
  footer,
}: {
  kicker: string;
  title: string;
  answer: string;
  picture: React.ReactNode;
  children: React.ReactNode;
  current: ArticlePath;
  nav: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="pp pp-article">
      {nav}
      <main id="top" className="za-main">
        <header className="za-hero">
          <p className="za-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="za-answer">{answer}</p>
        </header>
        <figure className="za-picture">{picture}</figure>
        {children}
        <section className="za-close" aria-labelledby="za-close-title">
          <h2 id="za-close-title">Try Zenod Memory.</h2>
          <p>Your first memories are free while we let in our first testers. No card.</p>
          <p className="pp-actions">
            <a className="pp-btn pp-btn-primary" href="/testers">
              Become a tester
            </a>
            <a className="pp-btn" href="/connect">
              Connect your AI tool
            </a>
          </p>
          <nav className="za-more" aria-label="More about Zenod Memory">
            {ARTICLE_LINKS.filter((link) => link.href !== current).map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            <a href="/vision">Why Zenod Memory exists</a>
          </nav>
        </section>
      </main>
      {footer}
    </div>
  );
}

const MEMORY_FLOW = [
  { title: "You speak or chat", text: "A voice note on WhatsApp, or a chat in Claude, ChatGPT or Cursor." },
  { title: "Zenod Memory files it", text: "Transcribed, put on the right page, linked to what you said before." },
  { title: "Markdown you own", text: "Plain files in your own GitHub repository or Google Drive." },
  { title: "Every AI reads it", text: "Your AI tools search and save to the same memory over MCP." },
];

function ZenodMemoryPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Shell
      kicker="What is Zenod Memory"
      title="Zenod Memory is one memory for you and all your AI tools."
      answer="You send voice notes on WhatsApp or talk to your AI tools as usual. Zenod Memory files what you say as plain Markdown in your own GitHub or Google Drive, and every AI tool you connect can read it."
      picture={<Flow steps={MEMORY_FLOW} label="How Zenod Memory works, in four steps" />}
      current="/zenod-memory"
      nav={nav}
      footer={footer}
    >
      <Section id="what" title="What it does">
        <p>
          Every AI chat starts from zero. What you told Claude last week, ChatGPT does not know, and your notes app
          knows neither. Zenod Memory is the one place all of it lands.
        </p>
        <ul>
          <li>Send a voice note on WhatsApp. Zenod Memory transcribes it, files it and replies with what it saved.</li>
          <li>Connect Claude, ChatGPT, Cursor, VS Code or Gemini CLI over MCP. They search your memory and save to it.</li>
          <li>Ask what you said about a person or a project, and get the answer with its sources.</li>
          <li>Switch on helpers that read your memory for you: loose ends, ideas to come back to, patterns.</li>
        </ul>
      </Section>
      <Section id="own" title="You own the files">
        <p>
          Your memory is ordinary Markdown in your own GitHub repository or Google Drive folder. You can open it in
          Obsidian or any editor, move it, or delete it. Nothing is locked in a database only we can read.
        </p>
      </Section>
      <Section id="run" title="Two ways to run it">
        <p>
          Zenod Memory is open source under the AGPL. Self-host it free with your own AI provider and Telegram, or use
          Zenod Hosted for €9 a month plus VAT, with AI usage and WhatsApp included. <a href="/pricing">See pricing</a>.
        </p>
      </Section>
      <Section id="name" title="Why it is called Zenod">
        <p>
          Zenod is named after Zenodotus, the first librarian of Alexandria. It is not Zenodo, the research archive
          run by CERN. <a href="/zenod-vs-zenodo">Zenod is not Zenodo</a>.
        </p>
      </Section>
    </Shell>
  );
}

const VS_HEADS = ["Zenod Memory", "Basic Memory", "Mem0"];
const VS_ROWS: Row[] = [
  {
    label: "Made for",
    cells: ["A person and all their AI tools", "A person working with an AI on their computer", "Developers adding memory to their own apps and agents"],
  },
  {
    label: "How you add to it",
    cells: ["WhatsApp voice notes, and any AI tool over MCP", "Chats with an AI tool over MCP, and editing the notes", "Calls from your app's code, through its API or library"],
  },
  {
    label: "Where memories live",
    cells: ["Markdown in your GitHub or Google Drive", "Markdown files on your computer, or its cloud", "A database in your setup or on its platform"],
  },
  {
    label: "Open source",
    cells: ["Yes, AGPL", "Yes, AGPL", "Yes, Apache 2.0"],
  },
  {
    label: "Hosted option",
    cells: ["Zenod Hosted, €9 a month plus VAT", "Basic Memory Cloud", "Mem0 Platform"],
  },
];

function VsPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Shell
      kicker="Comparison"
      title="Zenod Memory vs Basic Memory and Mem0"
      answer="Pick Zenod Memory to capture your life by voice on WhatsApp into Markdown you own. Pick Basic Memory for local notes with one AI. Pick Mem0 to build memory into your own app."
      picture={<Compare heads={VS_HEADS} rows={VS_ROWS} caption="The three side by side, as each describes itself" />}
      current="/zenod-vs-basic-memory-mem0"
      nav={nav}
      footer={footer}
    >
      <Section id="zenod" title="Zenod Memory">
        <p>
          A memory for one person that fills itself. You talk, by voice note on WhatsApp or in the AI tools you already
          use, and Zenod Memory files it as linked Markdown pages in your own GitHub or Google Drive. Every AI tool you
          connect over MCP reads the same memory. <a href="/zenod-memory">What is Zenod Memory</a>.
        </p>
      </Section>
      <Section id="basic-memory" title="Basic Memory">
        <p>
          An open-source MCP server that keeps a knowledge base as Markdown files on your computer, indexed locally, so
          an AI tool such as Claude can read and write notes with you. It also has a hosted cloud version. It suits
          you when you mostly work at a computer with one AI tool and want the files local.
        </p>
      </Section>
      <Section id="mem0" title="Mem0">
        <p>
          An open-source memory layer for developers: a library and an API that let your own app or agent remember its
          users across sessions, with a managed Mem0 Platform beside it. Its OpenMemory project gives MCP tools a shared
          memory. It suits you when you are building a product and need memory inside it.
        </p>
      </Section>
      <Section id="choose" title="Which one to choose">
        <ul>
          <li>You think out loud, on your phone, and want it filed for you: Zenod Memory.</li>
          <li>You want one memory that Claude, ChatGPT and Cursor all share, in files you own: Zenod Memory.</li>
          <li>You want a local notes folder that one AI helps you keep: Basic Memory.</li>
          <li>You are writing code and your app needs to remember its users: Mem0.</li>
        </ul>
        <p className="za-fine">
          About Basic Memory and Mem0 we say only what their own sites and code say, read on 26 November 2026. Each may
          have changed since.
        </p>
      </Section>
    </Shell>
  );
}

const ZENODO_ROWS: Row[] = [
  { label: "What it is", cells: ["A personal memory for you and your AI tools", "An open archive for research papers, data and code"] },
  { label: "Who runs it", cells: ["The Zenod team, or you if you self-host", "CERN, with OpenAIRE, since 2013"] },
  { label: "What you put in", cells: ["Voice notes and AI chats, filed as Markdown", "Finished research, each given a DOI"] },
  { label: "Who sees it", cells: ["Only you and the AI tools you connect", "Usually everyone: records are public"] },
  { label: "Address", cells: ["zenod.dev", "zenodo.org"] },
];

function ZenodoPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Shell
      kicker="Zenod or Zenodo"
      title="Zenod is not Zenodo."
      answer="Zenod Memory, at zenod.dev, is a private memory for you and your AI tools. Zenodo, at zenodo.org, is CERN's public archive for research. Different names, different jobs, no link between them."
      picture={<Compare heads={["Zenod Memory", "Zenodo"]} rows={ZENODO_ROWS} caption="Zenod Memory and Zenodo side by side" />}
      current="/zenod-vs-zenodo"
      nav={nav}
      footer={footer}
    >
      <Section id="looking-for-zenodo" title="Looking for Zenodo?">
        <p>
          Zenodo is the research repository run by CERN, where researchers share papers, datasets and software and get
          a DOI to cite. Go to <a href="https://zenodo.org/" rel="noreferrer">zenodo.org</a>. We are not part of it.
        </p>
      </Section>
      <Section id="looking-for-zenod" title="Looking for Zenod?">
        <p>
          Zenod Memory files your voice notes and AI chats as plain Markdown in your own GitHub or Google Drive, and lets
          Claude, ChatGPT, Cursor and other AI tools read the same memory over MCP. It is private to you, not a public
          archive. <a href="/zenod-memory">What is Zenod Memory</a>.
        </p>
      </Section>
      <Section id="name" title="Where the names come from">
        <p>
          Both names point to Zenodotus, the first librarian of the Library of Alexandria. Zenodo keeps the world's
          research. Zenod Memory keeps yours.
        </p>
      </Section>
    </Shell>
  );
}

export function ArticlePage({ path, nav, footer }: { path: ArticlePath; nav: React.ReactNode; footer: React.ReactNode }) {
  if (path === "/zenod-vs-basic-memory-mem0") return <VsPage nav={nav} footer={footer} />;
  if (path === "/zenod-vs-zenodo") return <ZenodoPage nav={nav} footer={footer} />;
  return <ZenodMemoryPage nav={nav} footer={footer} />;
}

export function isArticlePath(path: string): path is ArticlePath {
  return ARTICLE_LINKS.some((link) => link.href === path);
}
