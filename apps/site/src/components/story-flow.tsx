import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  BotIcon,
  BracesIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  HardDriveIcon,
  ImageIcon,
  LibraryIcon,
  MessageCircleIcon,
  Mic2Icon,
  NetworkIcon,
  QuoteIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WaypointsIcon,
} from "lucide-react";

import librarian640 from "@/assets/story/section-librarian-640.webp";
import librarian1280 from "@/assets/story/section-librarian-1280.webp";
import alexandria from "@/assets/alexandria.jpg";
import zenodPlate from "@/assets/zenod-plate.jpg";
import "./story-flow.css";

function StoryIntro({
  no,
  kicker,
  title,
  lead,
}: {
  no: string;
  kicker: string;
  title: ReactNode;
  lead: string;
}) {
  return (
    <div className="v5-story-intro">
      <span className="v5-section-no">{no}</span>
      <p className="v5-kicker">{kicker}</p>
      <h2>{title}</h2>
      <p className="v5-lead">{lead}</p>
    </div>
  );
}

function LibrarianArt({
  className = "",
  alt = "The Zenod librarian, a classical scholar holding an open book",
  eager = false,
}: {
  className?: string;
  alt?: string;
  eager?: boolean;
}) {
  return (
    <picture className={`v5-librarian-art ${className}`.trim()}>
      <source
        type="image/webp"
        srcSet={`${librarian640} 640w, ${librarian1280} 1280w`}
        sizes="(max-width: 760px) 92vw, (max-width: 1080px) 52vw, 38vw"
      />
      <img
        src={librarian1280}
        width={2752}
        height={1536}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        alt={alt}
      />
    </picture>
  );
}

const entryPoints = [
  {
    icon: MessageCircleIcon,
    label: "WhatsApp",
    detail: "voice note · 05:00",
    tone: "voice",
  },
  {
    icon: BracesIcon,
    label: "Codex",
    detail: "retrieve + write",
    tone: "agent",
  },
  {
    icon: SparklesIcon,
    label: "Claude",
    detail: "retrieve + write",
    tone: "agent",
  },
  {
    icon: BotIcon,
    label: "Grok Bot",
    detail: "retrieve + write",
    tone: "agent",
  },
  {
    icon: NetworkIcon,
    label: "Other agents",
    detail: "through MCP",
    tone: "other",
  },
];

function SectionOwnership() {
  return (
    <section className="v5-section v5-story-section" id="ownership">
      <div className="v5-wrap">
        <StoryIntro
          no="01 / OWNERSHIP"
          kicker="Your account starts here"
          title={
            <>
              Your memory.
              <br />
              <span className="v5-cyan">Your library.</span>{" "}
              <span className="v5-acid">Your librarian.</span>
            </>
          }
          lead="Zenod is not your memory. It is the librarian that stores, organizes, and connects it to your agents."
        />
      </div>

      <div className="v5-wrap v5-ownership-diagram">
        <aside className="v5-entry-panel" aria-label="Your entry points">
          <p className="v5-panel-label">Your entry points</p>
          <div className="v5-entry-list">
            {entryPoints.map(({ icon: Icon, label, detail, tone }) => (
              <div className={`v5-entry-card v5-entry-${tone}`} key={label}>
                <span className="v5-entry-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="v5-ownership-center">
          <div className="v5-flow-arrow v5-flow-arrow-in" aria-hidden="true" />
          <div className="v5-librarian-stage">
            <LibrarianArt eager />
            <div className="v5-librarian-shade" aria-hidden="true" />
          </div>
          <div className="v5-librarian-badge">
            <strong>ZENOD</strong>
            <span>THE MEMORY GATEKEEPER</span>
          </div>
          <div className="v5-flow-arrow v5-flow-arrow-out" aria-hidden="true" />
        </div>

        <aside className="v5-account-panel" aria-label="Your account">
          <div className="v5-account-head">
            <span className="v5-account-icon">
              <HardDriveIcon aria-hidden="true" />
            </span>
            <span>
              <strong>YOUR ACCOUNT</strong>
              <small>GitHub or Google Drive · your library stays yours</small>
            </span>
          </div>

          <div className="v5-account-layer v5-account-knowledge">
            <div className="v5-layer-head">
              <strong>CONNECTED KNOWLEDGE</strong>
              <span>index + meaning</span>
            </div>
            <div className="v5-layer-chips">
              <span>Index</span>
              <span>Projects</span>
              <span>People</span>
              <span>Preferences</span>
              <span>Open questions</span>
            </div>
          </div>

          <div className="v5-account-layer v5-account-originals">
            <div className="v5-layer-head">
              <strong>ORIGINALS</strong>
              <span>raw evidence</span>
            </div>
            <div className="v5-layer-chips">
              <span>Voice note</span>
              <span>Screenshot</span>
              <span>Document</span>
              <span>Source page</span>
            </div>
          </div>
        </aside>
      </div>

      <p className="v5-wrap v5-story-footnote">
        It stores. It categorizes. It connects.
      </p>
    </section>
  );
}

const captureSteps = [
  {
    no: "01",
    label: "CAPTURE",
    title: "A thought leaves the phone.",
    body: "A voice note, screenshot, link, or file arrives through a connected channel.",
    icon: Mic2Icon,
  },
  {
    no: "02",
    label: "ZENOD",
    title: "The librarian takes custody.",
    body: "The original is preserved. A transcript, summary, and source link are filed with it.",
    icon: LibraryIcon,
  },
  {
    no: "03",
    label: "YOUR STORAGE",
    title: "The library stays yours.",
    body: "Originals and connected Markdown live in your GitHub vault or Google Drive.",
    icon: DatabaseIcon,
  },
  {
    no: "04",
    label: "AGENT / MCP",
    title: "The work starts with context.",
    body: "Codex, Claude, or another MCP client retrieves the relevant part when you need it.",
    icon: WaypointsIcon,
  },
];

function SectionCapture() {
  return (
    <section className="v5-section v5-story-section" id="capture">
      <div className="v5-wrap">
        <StoryIntro
          no="02 / CAPTURE"
          kicker="One contact for whatever is on your mind"
          title="One contact. For whatever’s on your mind."
          lead="Capture the thought where it happens. Zenod preserves it, organizes it, and makes it useful to your agents."
        />
      </div>

      <div className="v5-wrap v5-capture-rail">
        {captureSteps.map(({ no, label, title, body, icon: Icon }, index) => (
          <div className="v5-capture-cell" key={label}>
            <article className="v5-capture-card">
              <span className="v5-capture-step">{no}</span>
              <span className="v5-capture-icon">
                <Icon aria-hidden="true" />
              </span>
              <p className="v5-panel-label">{label}</p>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
            {index < captureSteps.length - 1 ? (
              <span className="v5-capture-connector" aria-hidden="true">
                <ArrowRightIcon />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="v5-wrap v5-concept-note">
        Conceptual workflow · connected channels and agents vary by plan.
      </p>

      <div className="v5-wrap v5-capture-detail">
        <div className="v5-mini-note">
          <Mic2Icon aria-hidden="true" />
          <span>Voice note received</span>
          <b>Original preserved</b>
        </div>
        <div className="v5-mini-note">
          <FileTextIcon aria-hidden="true" />
          <span>Transcript + source link</span>
          <b>Ready for retrieval</b>
        </div>
        <div className="v5-mini-note">
          <ImageIcon aria-hidden="true" />
          <span>Screenshot saved</span>
          <b>Meaning connected</b>
        </div>
      </div>
    </section>
  );
}

const valueLayers = [
  {
    label: "ACTION",
    title: "Useful work",
    body: "The right context reaches the agent at the moment it can help.",
    className: "v5-value-action",
  },
  {
    label: "CONNECTED MEANING",
    title: "A coherent topic",
    body: "Transcripts, links, decisions, and related notes become one navigable thread.",
    className: "v5-value-meaning",
  },
  {
    label: "ORIGINAL EVIDENCE",
    title: "Your actual words",
    body: "The source stays intact. Everything else can be rebuilt from it.",
    className: "v5-value-evidence",
  },
];

function SectionCultivate() {
  return (
    <section className="v5-section v5-story-section" id="cultivate">
      <div className="v5-wrap v5-cultivate-grid">
        <StoryIntro
          no="03 / CULTIVATE"
          kicker="Extract more intelligence"
          title="Cultivate your context."
          lead="Every layer makes the raw material more useful: evidence preserved, meaning connected, action grounded."
        />

        <div
          className="v5-value-stack"
          aria-label="Value grows from evidence to meaning to action"
        >
          {valueLayers.map((layer, index) => (
            <article
              className={`v5-value-layer ${layer.className}`}
              key={layer.label}
            >
              <span className="v5-value-index">0{valueLayers.length - index}</span>
              <div>
                <p className="v5-panel-label">{layer.label}</p>
                <h3>{layer.title}</h3>
                <p>{layer.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionGrounding() {
  return (
    <section className="v5-section v5-story-section" id="grounding">
      <div className="v5-wrap">
        <StoryIntro
          no="04 / GROUNDING"
          kicker="Evidence stays attached"
          title="Keep the original. Connect the meaning."
          lead="Grounded knowledge stays linked to the evidence it came from."
        />
      </div>

      <div className="v5-wrap v5-grounding-grid">
        <div className="v5-evidence-stack">
          <p className="v5-panel-label">Raw evidence</p>
          <article className="v5-evidence-card">
            <Mic2Icon aria-hidden="true" />
            <div>
              <strong>Voice note</strong>
              <span>What you actually said · 05:00</span>
            </div>
          </article>
          <article className="v5-evidence-card">
            <ImageIcon aria-hidden="true" />
            <div>
              <strong>Screenshot</strong>
              <span>The reference you saved at the time</span>
            </div>
          </article>
          <article className="v5-evidence-card">
            <FileTextIcon aria-hidden="true" />
            <div>
              <strong>Written note</strong>
              <span>The decision you wanted to remember</span>
            </div>
          </article>
        </div>

        <div className="v5-grounding-bridge" aria-hidden="true">
          <span>source links</span>
        </div>

        <article className="v5-collection-card">
          <div className="v5-collection-head">
            <div>
              <p className="v5-panel-label">Connected knowledge</p>
              <h3>Finding a home</h3>
            </div>
            <BookOpenIcon aria-hidden="true" />
          </div>
          <p>
            One topic page gathers the fragments, but every claim still points
            back to the original source.
          </p>
          <div className="v5-source-links">
            <span>↳ Voice note · 05:00</span>
            <span>↳ Screenshot · saved source</span>
            <span>↳ Note · project decision</span>
          </div>
        </article>
      </div>
    </section>
  );
}

function SectionRecall() {
  return (
    <section className="v5-section v5-story-section" id="recall">
      <div className="v5-wrap v5-recall-layout">
        <StoryIntro
          no="05 / RECALL"
          kicker="Ask the librarian"
          title="Ask the librarian. Get back to the source."
          lead="Find the thought you remember vaguely. Return to what you actually said."
        />

        <div className="v5-recall-stage">
          <article className="v5-recall-question">
            <div className="v5-recall-head">
              <SearchIcon aria-hidden="true" />
              <span>YOU ASK</span>
            </div>
            <p>
              “What did I mean when I said the landing page should feel like
              the librarian, not the library?”
            </p>
          </article>

          <div className="v5-recall-arrow" aria-hidden="true">
            <ArrowRightIcon />
          </div>

          <article className="v5-recall-answer">
            <div className="v5-recall-head">
              <QuoteIcon aria-hidden="true" />
              <span>ZENOD RETRIEVES</span>
            </div>
            <p>
              You wanted the page to show the human-shaped job Zenod performs:
              custody, organization, and a reliable way back to the source.
            </p>
            <div className="v5-answer-rule">
              <ShieldCheckIcon aria-hidden="true" />
              <span>Grounded by facts and linked evidence</span>
            </div>
          </article>

          <div className="v5-source-strip">
            <span>SOURCE</span>
            <strong>Voice note · 03:42</strong>
            <span>Original preserved · transcript linked</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const agentNodes = [
  { label: "Codex", detail: "retrieve + write", className: "v5-node-codex" },
  { label: "Claude", detail: "retrieve + write", className: "v5-node-claude" },
  { label: "Grok Bot", detail: "retrieve + write", className: "v5-node-grok" },
  {
    label: "Other MCP clients",
    detail: "retrieve + write",
    className: "v5-node-other",
  },
];

function AgentNode({
  label,
  detail,
  className,
}: {
  label: string;
  detail: string;
  className: string;
}) {
  return (
    <article className={`v5-agent-node ${className}`}>
      <BotIcon aria-hidden="true" />
      <strong>{label}</strong>
      <span>{detail}</span>
    </article>
  );
}

function SectionAgents() {
  return (
    <section className="v5-section v5-story-section" id="agents">
      <div className="v5-wrap">
        <StoryIntro
          no="06 / AGENTS"
          kicker="One shared starting point"
          title="Every agent. One shared starting point."
          lead="Codex, Claude, Grok Bot, and other MCP clients retrieve from and contribute to the same context through Zenod."
        />
      </div>

      <p className="v5-wrap v5-concept-note v5-concept-note-agents">
        Conceptual workflow · every connection still passes through the same
        controlled memory gateway.
      </p>

      <div
        className="v5-wrap v5-agent-network"
        aria-label="Agents connected to one shared Zenod library"
      >
        <svg
          className="v5-agent-lines"
          viewBox="0 0 1000 560"
          fill="none"
          aria-hidden="true"
        >
          <path d="M236 126 C 350 126, 380 240, 470 262" />
          <path d="M764 126 C 650 126, 620 240, 530 262" />
          <path d="M236 434 C 350 434, 380 320, 470 298" />
          <path d="M764 434 C 650 434, 620 320, 530 298" />
          <path d="M500 75 L500 225" />
          <path d="M500 485 L500 335" />
          <circle cx="500" cy="280" r="112" />
        </svg>

        <div className="v5-agent-gateway">
          <LibraryIcon aria-hidden="true" />
          <strong>YOUR LIBRARY</strong>
          <span>ZENOD MCP GATEWAY</span>
          <small>One controlled release of context</small>
        </div>

        {agentNodes.map((node) => (
          <AgentNode key={node.label} {...node} />
        ))}

        <div className="v5-agent-flow-key">
          <span>AGENT → ZENOD</span>
          <b>write</b>
          <i />
          <span>ZENOD → AGENT</span>
          <b>retrieve</b>
        </div>
      </div>
    </section>
  );
}

function SectionCustodians() {
  return (
    <section className="v5-section v5-story-section" id="custodians">
      <div className="v5-wrap">
        <StoryIntro
          no="07 / CUSTODIANS"
          kicker="The books outlive the librarian"
          title="Keep the books. Replace the librarian."
          lead="Your originals keep their value. Future custodians can derive new meaning from the same evidence."
        />
      </div>

      <div className="v5-wrap v5-custodian-timeline">
        <article className="v5-custodian-step">
          <span className="v5-panel-label">UNCHANGED ORIGINALS</span>
          <div className="v5-custodian-art v5-custodian-art-originals">
            <FileTextIcon aria-hidden="true" />
            <FileTextIcon aria-hidden="true" />
            <Mic2Icon aria-hidden="true" />
          </div>
          <h3>Your evidence</h3>
          <p>Plain Markdown, original files, and a complete history.</p>
          <small>NEVER REWRITTEN</small>
        </article>

        <div className="v5-custodian-arrow" aria-hidden="true">
          <ArrowRightIcon />
        </div>

        <article className="v5-custodian-step v5-custodian-today">
          <span className="v5-panel-label">MEANING TODAY</span>
          <div className="v5-custodian-art">
            <LibraryIcon aria-hidden="true" />
          </div>
          <h3>Zenod is the first custodian</h3>
          <p>It organizes the library and keeps today’s index grounded.</p>
          <small>NOT THE LAST</small>
        </article>

        <div className="v5-custodian-arrow" aria-hidden="true">
          <ArrowRightIcon />
        </div>

        <article className="v5-custodian-step v5-custodian-future">
          <span className="v5-panel-label">MEANING REBUILT</span>
          <div className="v5-custodian-art">
            <GitBranchIcon aria-hidden="true" />
          </div>
          <h3>A future librarian can start again</h3>
          <p>The same originals can support a better index ten years from now.</p>
          <small>SAME EVIDENCE · NEW MEANING</small>
        </article>
      </div>
    </section>
  );
}

function SectionAlexandria() {
  return (
    <section className="v5-section v5-alexandria" id="alexandria">
      <img src={alexandria} alt="The Great Library of Alexandria" />
      <div className="v5-wrap v5-alexandria-inner">
        <div>
          <p className="v5-eyebrow v5-gold">09 / THE LIBRARIAN</p>
          <h2>Zenodotus · The librarian of Alexandria.</h2>
          <div className="v5-short-lines">
            <p>The library was the place.</p>
            <p>The librarian made it usable.</p>
            <p>Zenod is named after the job, not the building.</p>
          </div>
          <p className="v5-muted">
            Zenodotus controlled what entered the collection, created the
            first catalog, and made retrieval possible. The organizing problem
            is still the same.
          </p>
          <div className="v5-alexandria-jobs" aria-label="The librarian's job">
            <span>
              <b>01</b> Ingestion
            </span>
            <span>
              <b>02</b> Organization
            </span>
            <span>
              <b>03</b> Retrieval
            </span>
          </div>
        </div>
        <figure>
          <img src={zenodPlate} alt="Zenod, the Librarian" />
          <figcaption>
            <b>ZENODOTUS → ZENOD</b>
            <p>The gatekeeper that keeps your digital memory usable.</p>
            <small>ANCIENT JOB · MODERN INTERFACE</small>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function StoryFlow({ offer }: { offer: ReactNode }) {
  return (
    <>
      <SectionOwnership />
      <SectionCapture />
      <SectionCultivate />
      <SectionGrounding />
      <SectionRecall />
      <SectionAgents />
      <SectionCustodians />
      {offer}
      <SectionAlexandria />
    </>
  );
}

export function ClosingStorySection() {
  return (
    <section className="v5-section v5-closing-story" id="build">
      <div className="v5-wrap v5-closing-grid">
        <div className="v5-closing-copy">
          <p className="v5-kicker">10 / START YOUR LIBRARY</p>
          <h2>
            Start building your{" "}
            <span className="v5-cyan">Library of Alexandria.</span>
          </h2>
          <p className="v5-lead">
            Get Zenod to work on your context. Let it help you cultivate it.
          </p>
          <div className="v5-actions">
            <a
              className="v5-button v5-button-primary"
              href="https://github.com/zenod-ai/zenod"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub <ArrowUpRightIcon />
            </a>
            <a className="v5-button" href="#start">
              Choose a plan <ArrowRightIcon />
            </a>
          </div>
        </div>

        <div className="v5-closing-art">
          <LibrarianArt
            className="v5-closing-librarian"
            alt="The Zenod librarian beside the entrance to a personal library"
          />
          <div className="v5-closing-threshold" aria-hidden="true" />
          <div className="v5-closing-caption">
            <CloudIcon aria-hidden="true" />
            <span>YOUR MEMORY, PORTABLE AND YOURS</span>
          </div>
        </div>
      </div>
    </section>
  );
}
