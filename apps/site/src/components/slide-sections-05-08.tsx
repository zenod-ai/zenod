import type { ReactNode } from "react";

import recall640 from "@/assets/story/slide-05/recall-layer-640.webp";
import recall1280 from "@/assets/story/slide-05/recall-layer-1280.webp";
import agents640 from "@/assets/story/slide-06/agents-layer-640.webp";
import agents1280 from "@/assets/story/slide-06/agents-layer-1280.webp";
import custodians640 from "@/assets/story/slide-07/custodians-layer-640.webp";
import custodians1280 from "@/assets/story/slide-07/custodians-layer-1280.webp";
import runItYourWay640 from "@/assets/story/slide-08/run-it-your-way-layer-640.webp";
import runItYourWay1280 from "@/assets/story/slide-08/run-it-your-way-layer-1280.webp";

import "./slide-sections-05-08.css";

function StoryIntro({
  no,
  kicker,
  title,
  lead,
}: {
  no: string;
  kicker: string;
  title: string;
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

function StoryDiagram({
  src640,
  src1280,
  width,
  height,
  alt,
}: {
  src640: string;
  src1280: string;
  width: number;
  height: number;
  alt: string;
}) {
  return (
    <figure className="v5-story-diagram">
      <img
        src={src1280}
        srcSet={`${src640} 640w, ${src1280} 1280w`}
        sizes="(max-width: 760px) calc(100vw - 24px), min(1240px, calc(100vw - 40px))"
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        alt={alt}
      />
    </figure>
  );
}

function SlideFiveRecallSection() {
  return (
    <section className="v5-section v5-story-section" id="recall">
      <div className="v5-wrap">
        <StoryIntro
          no="05 / RECALL"
          kicker="Ask the librarian"
          title="Ask the librarian. Get back to the source."
          lead="Find the thought you remember vaguely. Return to what you actually said."
        />
        <StoryDiagram
          src640={recall640}
          src1280={recall1280}
          width={1280}
          height={714}
          alt="A question becomes a grounded answer, with a visible path back to the original voice note."
        />
      </div>
    </section>
  );
}

function SlideSixAgentsSection() {
  return (
    <section className="v5-section v5-story-section" id="agents">
      <div className="v5-wrap">
        <StoryIntro
          no="06 / AGENTS"
          kicker="One shared starting point"
          title="Every agent. One shared starting point."
          lead="Codex, Claude, Grok Bot and other MCP clients retrieve from and contribute to the same context through Zenod."
        />
        <StoryDiagram
          src640={agents640}
          src1280={agents1280}
          width={1280}
          height={714}
          alt="Agent marks connect through one central Zenod gateway to a single shared library."
        />
        <p className="v5-concept-note">
          Conceptual workflow · every connection still passes through the same
          controlled memory gateway.
        </p>
      </div>
    </section>
  );
}

function SlideSevenCustodiansSection() {
  return (
    <section className="v5-section v5-story-section" id="custodians">
      <div className="v5-wrap">
        <StoryIntro
          no="07 / CUSTODIANS"
          kicker="The books outlive the librarian"
          title="Keep the books. Replace the librarian."
          lead="Your originals keep their value. Future custodians can derive new meaning from the same evidence."
        />
        <StoryDiagram
          src640={custodians640}
          src1280={custodians1280}
          width={1280}
          height={714}
          alt="A timeline shows unchanged originals supporting today’s meaning and a future meaning rebuilt from the same evidence."
        />
      </div>
    </section>
  );
}

function SlideEightRunItYourWaySection({ offer }: { offer: ReactNode }) {
  return (
    <section className="v5-section v5-story-section" id="start">
      <div className="v5-wrap">
        <StoryIntro
          no="08 / RUN IT YOUR WAY"
          kicker="Self-host or hosted"
          title="Run it your way."
          lead="The same open-source engine can run on your infrastructure or ours. The library stays yours."
        />
        <StoryDiagram
          src640={runItYourWay640}
          src1280={runItYourWay1280}
          width={1280}
          height={714}
          alt="A visual comparison of self-hosted and hosted Zenod, with the user’s library remaining portable."
        />
        <div className="v5-story-offer-slot">{offer}</div>
      </div>
    </section>
  );
}

export function SlideBatch0508({ offer }: { offer: ReactNode }) {
  return (
    <>
      <SlideFiveRecallSection />
      <SlideSixAgentsSection />
      <SlideSevenCustodiansSection />
      <SlideEightRunItYourWaySection offer={offer} />
    </>
  );
}
