import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode, SVGProps } from "react";

const storyAssets = import.meta.glob("../assets/story/*.{webp,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function asset(name: string) {
  const resolved = storyAssets[`../assets/story/${name}`];
  if (!resolved) {
    throw new Error(`Missing story asset: ${name}`);
  }
  return resolved;
}

function GithubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function DriveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m9 4 6 0 6 10-3 5H6l-3-5 6-10Z" />
      <path d="M9 4 3 14M15 4l6 10M6 19l6-10 6 10" />
    </svg>
  );
}

interface StoryEntry {
  id: string;
  no: string;
  title: ReactNode;
  body: ReactNode;
  image?: {
    base: string;
    alt: string;
  };
}

const storyEntries: StoryEntry[] = [
  {
    id: "story-ownership",
    no: "01",
    title: "Your memory. Your library. Your librarian.",
    body: (
      <>
        Zenod is not your memory. It is the librarian that{" "}
        <strong>stores, organizes, and connects</strong> it to your agents.
      </>
    ),
    image: {
      base: "01-ownership",
      alt: "Multiple agent entry points feed one Zenod librarian, which maintains a Google Drive account containing originals and connected knowledge.",
    },
  },
  {
    id: "story-capture",
    no: "02",
    title: "One contact. For whatever’s on your mind.",
    body: "Capture a voice note. Zenod preserves it, organizes it, and makes it available to your agents.",
    image: {
      base: "02-capture-journey",
      alt: "A voice note travels from a phone through Zenod into Google Drive and Obsidian, then back to an agent through MCP.",
    },
  },
  {
    id: "story-cultivate",
    no: "03",
    title: "Cultivate your context. Extract more intelligence.",
    body: "Every layer turns raw data into more useful, grounded knowledge: evidence, connected meaning, then action.",
    image: {
      base: "03-cultivate-context",
      alt: "An expanding value pyramid moves from original evidence to connected meaning to useful work and action.",
    },
  },
  {
    id: "story-grounding",
    no: "04",
    title: "Keep the original. Connect the meaning.",
    body: "Grounded knowledge stays linked to the evidence it came from.",
    image: {
      base: "04-raw-connected",
      alt: "A finding-a-home collection sits above its raw evidence, with source links running back to each original.",
    },
  },
  {
    id: "story-recall",
    no: "05",
    title: "Ask the librarian. Get back to the source.",
    body: "Find the thought you remember vaguely. Return to what you actually said.",
    image: {
      base: "05-recall",
      alt: "A question produces a grounded answer linked directly to the original voice note.",
    },
  },
  {
    id: "story-agents",
    no: "06",
    title: "Every agent. One shared starting point.",
    body: "Codex, Claude, Grok Bot, and your other agents retrieve from and contribute to your context through MCP.",
    image: {
      base: "06-agent-mcp",
      alt: "Codex, Claude, and Grok Bot connect bidirectionally through Zenod as the MCP gateway into one shared library.",
    },
  },
  {
    id: "story-custodians",
    no: "07",
    title: "Keep the books. Replace the librarian.",
    body: "Your raw thoughts keep their value. Future custodians can derive new meaning from the same evidence.",
    image: {
      base: "07-custodians",
      alt: "Unchanged originals support today’s meaning state and a new meaning state created ten years later.",
    },
  },
  {
    id: "story-your-way",
    no: "08",
    title: "Run it your way.",
    body: "The same open-source engine can run on your infrastructure or ours. The library stays yours.",
  },
];

function OfferPanel() {
  return (
    <div className="v5-story-offer">
      <div className="v5-story-offer-grid">
        <article>
          <span className="v5-micro">SELF-HOST</span>
          <strong>Free</strong>
          <p>Run Zenod on your VPS with your own AI provider key.</p>
          <small>GitHub vault</small>
        </article>
        <article className="v5-story-offer-hosted">
          <span className="v5-micro">ZENOD HOSTED</span>
          <strong>
            €9 <small>/ month + VAT</small>
          </strong>
          <p>Managed, always-on memory with WhatsApp included.</p>
          <small>GitHub or Google Drive</small>
        </article>
      </div>
      <div className="v5-story-offer-band">
        <span className="v5-story-source-icon">
          <GithubMark />
        </span>
        <span className="v5-story-source-icon">
          <DriveIcon />
        </span>
        <b>Your library stays yours.</b>
        <span>Plain Markdown. Portable by default.</span>
      </div>
      <a className="v5-button" href="#start">
        See current plans <ArrowUpRightIcon />
      </a>
    </div>
  );
}

export function StoryDeck() {
  return (
    <section className="v5-section v5-story" id="story" aria-labelledby="story-title">
      <div className="v5-story-intro">
        <div>
          <p className="v5-kicker">The Zenod story</p>
          <h2 id="story-title">One memory. Every agent. Yours.</h2>
        </div>
        <p className="v5-lead">
          The slides behind the product, promoted into the page as a responsive
          story sequence.
        </p>
      </div>

      <div className="v5-story-list">
        {storyEntries.map((entry) => (
          <article className="v5-story-slide" id={entry.id} key={entry.id}>
            <div className="v5-story-copy">
              <span className="v5-story-no">{entry.no}</span>
              <h3>{entry.title}</h3>
              <p>{entry.body}</p>
            </div>
            {entry.image ? (
              <figure className="v5-story-visual">
                <picture>
                  <source
                    type="image/webp"
                    srcSet={`${asset(`${entry.image.base}-640.webp`)} 640w, ${asset(`${entry.image.base}-1280.webp`)} 1280w`}
                    sizes="(max-width: 620px) calc(100vw - 24px), (max-width: 960px) calc(100vw - 40px), min(960px, calc(100vw - 420px))"
                  />
                  <img
                    src={asset(`${entry.image.base}-1280.jpg`)}
                    srcSet={`${asset(`${entry.image.base}-1280.jpg`)} 1280w`}
                    sizes="(max-width: 620px) calc(100vw - 24px), (max-width: 960px) calc(100vw - 40px), min(960px, calc(100vw - 420px))"
                    width={2752}
                    height={1536}
                    loading="lazy"
                    decoding="async"
                    alt={entry.image.alt}
                  />
                </picture>
              </figure>
            ) : (
              <OfferPanel />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
