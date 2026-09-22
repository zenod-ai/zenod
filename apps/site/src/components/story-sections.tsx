import type { ReactNode } from "react";
import ownership from "@/assets/story/01-ownership.webp";
import ownershipSmall from "@/assets/story/01-ownership-small.webp";
import capture from "@/assets/story/02-capture.webp";
import captureSmall from "@/assets/story/02-capture-small.webp";
import cultivate from "@/assets/story/03-cultivate.webp";
import cultivateSmall from "@/assets/story/03-cultivate-small.webp";
import originals from "@/assets/story/04-originals.webp";
import originalsSmall from "@/assets/story/04-originals-small.webp";
import recall from "@/assets/story/05-recall.webp";
import recallSmall from "@/assets/story/05-recall-small.webp";
import agents from "@/assets/story/06-agents.webp";
import agentsSmall from "@/assets/story/06-agents-small.webp";
import custodians from "@/assets/story/07-custodians.webp";
import custodiansSmall from "@/assets/story/07-custodians-small.webp";
import options from "@/assets/story/08-options.webp";
import optionsSmall from "@/assets/story/08-options-small.webp";
import alexandria from "@/assets/story/09-alexandria.webp";
import alexandriaSmall from "@/assets/story/09-alexandria-small.webp";
import invitation from "@/assets/story/10-invitation.webp";
import invitationSmall from "@/assets/story/10-invitation-small.webp";

type Chapter = {
  id: string;
  source: string;
  kicker: string;
  title: string;
  accent: string;
  lead: string;
  image: string;
  small: string;
  alt: string;
  captions: readonly [string, string][];
  note?: string;
};

// Diagram-only assets, never complete slide screenshots. All section-level copy is HTML.
// Alexandria precedes the offer as specified in the landing-story spine.
export const storyChapters: readonly Chapter[] = [
  {
    id: "context",
    source: "01",
    kicker: "Good access starts with good organization",
    title: "Your memory. Your library.",
    accent: "Your librarian.",
    lead: "Your digital memory lives in your account. Zenod has permission to maintain it. It stores. It categorizes. It connects.",
    image: ownership,
    small: ownershipSmall,
    alt: "WhatsApp voice notes and connected agents exchange context through the Zenod librarian. A cyan boundary marks your own Google Drive account, containing linked projects, people, preferences and open questions above preserved original evidence.",
    captions: [
      [
        "Your ideas, anytime, anywhere.",
        "Capture through a conversation or a connected agent.",
      ],
      [
        "Your librarian. Not your library.",
        "Zenod organizes, connects and maintains your memory.",
      ],
      [
        "Your account. Your control.",
        "Connected knowledge stays linked to its original evidence.",
      ],
    ],
    note: "Google Drive shown here is a Hosted storage option. Self-hosted uses your GitHub vault; Hosted lets you choose GitHub or an app-created Google Drive folder.",
  },
  {
    id: "journey",
    source: "02",
    kicker: "Capture it where it happens",
    title: "One contact.",
    accent: "For whatever’s on your mind.",
    lead: "Capture a voice note. Zenod preserves it, organizes it, and makes relevant context available to your connected agents.",
    image: capture,
    small: captureSmall,
    alt: "A WhatsApp voice note passes through Zenod’s classical Hellenic librarian to preserved audio, transcripts and connected files. Both branches return through the same librarian, shown again as the Zenod MCP gateway, before reaching the agent. Google Drive and Obsidian-compatible files illustrate storage and reading, respectively.",
    captions: [
      [
        "Speak while the thought is fresh.",
        "Send what you want to remember, without stopping to file it.",
      ],
      [
        "Keep the original and transcript.",
        "Your recording remains available alongside its written meaning.",
      ],
      [
        "Use it where you work.",
        "Connected agents retrieve relevant context through Zenod.",
      ],
    ],
    note: "Illustrative capture flow. WhatsApp is included with Hosted; Telegram is available for self-hosted use. Obsidian reads compatible Markdown files; it is not a separate hosted storage service.",
  },
  {
    id: "cultivate",
    source: "03",
    kicker: "Turn evidence into useful context",
    title: "Cultivate your context.",
    accent: "Extract more intelligence.",
    lead: "Every layer turns raw material into more useful, grounded knowledge.",
    image: cultivate,
    small: cultivateSmall,
    alt: "Three widening illustrated layers rise from original evidence—audio, documents and pictures—to connected meaning—preferences, projects and relationships—and then action—plans, decisions and work. Cyan arrows connect each layer.",
    captions: [
      [
        "Start with what actually happened.",
        "Original recordings, documents and pictures form the foundation.",
      ],
      [
        "Connect what it means.",
        "Preferences, projects and relationships add context.",
      ],
      [
        "Put that context to work.",
        "Give your agents a grounded starting point for plans and decisions.",
      ],
    ],
  },
  {
    id: "originals",
    source: "04",
    kicker: "Evidence and meaning, together",
    title: "Keep the original.",
    accent: "Connect the meaning.",
    lead: "Grounded knowledge stays linked to the evidence it came from.",
    image: originals,
    small: originalsSmall,
    alt: "A voice note about natural light, a bright flat photograph and a note about the commute pass through the librarian into a Finding a home collection. Dotted source links connect the collection back to the same three preserved originals.",
    captions: [
      [
        "A voice note. A picture. A thought.",
        "Different fragments can belong to the same story.",
      ],
      [
        "One connected collection.",
        "Bring together what matters, places considered and open questions.",
      ],
      [
        "A way back to every source.",
        "The original evidence remains available beneath the synthesis.",
      ],
    ],
    note: "Illustrative collection, not a product screenshot.",
  },
  {
    id: "recall",
    source: "05",
    kicker: "Find the thought you remember vaguely",
    title: "Ask the librarian.",
    accent: "Get back to the source.",
    lead: "Return to what you actually said—not just a plausible answer about it.",
    image: recall,
    small: recallSmall,
    alt: "An illustrated conversation asks, What did I say about the light in that flat? The answer, You loved the natural light, is connected to the original voice note. A librarian reads a scroll alongside the conversation.",
    captions: [
      [
        "Ask in your own words.",
        "“What did I say about the light in that flat?”",
      ],
      [
        "Recover the relevant thought.",
        "The answer is grounded in your stored evidence.",
      ],
      [
        "Follow it back to the original.",
        "Connected thought → original recording → cited answer.",
      ],
    ],
    note: "Illustrative conversation. The pictured audio control is part of the diagram, not a playable recording.",
  },
  {
    id: "agents",
    source: "06",
    kicker: "One gateway for connected agents",
    title: "Every agent.",
    accent: "One shared starting point.",
    lead: "Compatible MCP clients can retrieve from and contribute to your context through Zenod.",
    image: agents,
    small: agentsSmall,
    alt: "A library of scrolls sits at the center below a distinct Zenod MCP gateway. Codex, Claude and other connected agents surround it. Retrieve arrows point out from the gateway to agents; write arrows point back from agents to Zenod.",
    captions: [
      [
        "Retrieve the relevant context.",
        "Your agent asks Zenod for what the current task needs.",
      ],
      [
        "Write through the librarian.",
        "New context goes through the gateway, not around it.",
      ],
      [
        "Keep one shared library.",
        "Change the agent without starting your memory over.",
      ],
    ],
    note: "Conceptual MCP topology. Named agents require a compatible client and a configured connection; this does not imply automatic access.",
  },
  {
    id: "freedom",
    source: "07",
    kicker: "No model lock-in. No Zenod lock-in.",
    title: "Keep the books.",
    accent: "Replace the librarian.",
    lead: "Your raw thoughts keep their value. Future custodians can derive new meaning from the same evidence.",
    image: custodians,
    small: custodiansSmall,
    alt: "A timeline connects unchanged original audio, documents and images to a meaning map today and a rebuilt meaning map ten years later. Zenod is the first custodian; a different librarian can build on the same originals.",
    captions: [
      ["Zenod is the first custodian.", "Not necessarily the last."],
      [
        "Meaning can evolve.",
        "A future librarian can connect the evidence differently.",
      ],
      [
        "Your originals remain yours.",
        "Keep your library in ordinary Markdown in your own account.",
      ],
    ],
    note: "Conceptual lifecycle, not a ten-year retention or service guarantee.",
  },
  {
    id: "alexandria",
    source: "09",
    kicker: "Why the product is named Zenod",
    title: "Zenodotus.",
    accent: "The librarian of Alexandria.",
    lead: "The library was the place. The librarian made it usable.",
    image: alexandria,
    small: alexandriaSmall,
    alt: "An allegory of the Library of Alexandria: people bring scrolls to a librarian at the gate, scrolls are organized on shelves, and a requested scroll is retrieved. A cyan path connects ingestion, organization and retrieval.",
    captions: [
      ["At the gate.", "Give incoming material a place in the collection."],
      [
        "Inside the library.",
        "Organize the collection so it can be found again.",
      ],
      [
        "Back into the world.",
        "Bring the right knowledge back when it is needed.",
      ],
    ],
    note: "A visual metaphor for Zenod’s role: the librarian, not the library.",
  },
  {
    id: "start",
    source: "08",
    kicker: "Same open-source engine",
    title: "Run it",
    accent: "your way.",
    lead: "Choose where Zenod runs. Keep the library in your own account.",
    image: options,
    small: optionsSmall,
    alt: "The same open-source librarian branches to a self-hosted server with Telegram or a managed Hosted service with Telegram and WhatsApp. A separate lower band shows GitHub storage for either edition and Google Drive for Hosted.",
    captions: [
      [
        "Self-hosted.",
        "Your server, your AI provider key and your GitHub vault.",
      ],
      [
        "Zenod Hosted.",
        "Managed service, managed AI usage and WhatsApp included.",
      ],
      [
        "Your library stays yours.",
        "Hosted: GitHub or Drive. Self-hosted: GitHub.",
      ],
    ],
  },
  {
    id: "build-your-library",
    source: "10",
    kicker: "Your context already matters",
    title: "Start building your",
    accent: "Library of Alexandria.",
    lead: "Get Zenod to work on your context. Let it help you cultivate it.",
    image: invitation,
    small: invitationSmall,
    alt: "The illustrated librarian stands beside an open door into a library of scrolls. A bright cyan path leads through the doorway.",
    captions: [],
  },
];

export function StorySections({ pricing }: { pricing: ReactNode }) {
  return (
    <div className="zls-story">
      {storyChapters.map((chapter, index) => (
        <section
          className="zls-chapter"
          id={chapter.id}
          key={chapter.id}
          data-story-source={chapter.source}
          aria-labelledby={chapter.id + "-title"}
        >
          <div className="v5-wrap zls-heading">
            <p className="zls-eyebrow">
              <span>{String(index + 1).padStart(2, "0")}</span> {chapter.kicker}
            </p>
            <h2 id={chapter.id + "-title"}>
              {chapter.title}
              <br />
              <span>{chapter.accent}</span>
            </h2>
            <p className="zls-lead">{chapter.lead}</p>
          </div>
          <figure className="zls-figure">
            <a
              className="zls-image-link"
              href={chapter.image}
              target="_blank"
              rel="noreferrer"
              aria-label={
                "Open full-size diagram: " +
                chapter.title +
                " " +
                chapter.accent +
                " (new tab)"
              }
            >
              <img
                src={chapter.image}
                srcSet={chapter.small + " 960w, " + chapter.image + " 1774w"}
                sizes="(max-width: 1480px) 100vw, 1480px"
                width={1774}
                height={887}
                loading="lazy"
                decoding="async"
                alt={chapter.alt}
              />
            </a>
            <figcaption className="v5-wrap">
              {chapter.captions.length > 0 && (
                <div className="zls-captions">
                  {chapter.captions.map(([title, body]) => (
                    <div key={title}>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="zls-figure-meta">
                {chapter.note && <p>{chapter.note}</p>}
                <a
                  href={chapter.image}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    "View full-size " +
                    chapter.kicker.toLowerCase() +
                    " diagram (new tab)"
                  }
                >
                  View full-size diagram ↗
                </a>
              </div>
            </figcaption>
          </figure>
          {chapter.id === "start" && (
            <div className="v5-wrap zls-pricing">{pricing}</div>
          )}
          {chapter.id === "build-your-library" && (
            <div className="v5-wrap zls-closing-actions">
              <a
                className="v5-button"
                href="https://github.com/zenod-ai/zenod"
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub ↗
              </a>
              <a className="v5-button v5-button-primary" href="/pricing">
                Choose a plan ↗
              </a>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
