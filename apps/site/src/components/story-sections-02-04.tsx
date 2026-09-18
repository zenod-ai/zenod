import captureJourney1280 from "@/assets/story/02-capture-journey/02-capture-journey-1280.webp";
import captureJourney2752 from "@/assets/story/02-capture-journey/02-capture-journey-2752.webp";
import cultivateContext1280 from "@/assets/story/03-cultivate-context/03-cultivate-context-1280.webp";
import cultivateContext2752 from "@/assets/story/03-cultivate-context/03-cultivate-context-2752.webp";
import rawConnected1280 from "@/assets/story/04-raw-connected/04-raw-connected-1280.webp";
import rawConnected2752 from "@/assets/story/04-raw-connected/04-raw-connected-2752.webp";
import "./story-diagrams-02-04.css";

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
  src,
  srcSet,
  width,
  height,
  alt,
  className = "",
}: {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
}) {
  return (
    <figure className={`v5-story-diagram ${className}`.trim()}>
      <img
        src={src}
        srcSet={srcSet}
        sizes="(max-width: 760px) 100vw, min(1240px, calc(100vw - 40px))"
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        alt={alt}
      />
    </figure>
  );
}

export function CaptureStorySection() {
  return (
    <section className="v5-section v5-story-section" id="capture">
      <div className="v5-wrap">
        <StoryIntro
          no="02 / CAPTURE"
          kicker="One contact for whatever is on your mind"
          title="One contact. For whatever’s on your mind."
          lead="Capture the thought where it happens. Zenod preserves it, organizes it, and makes it useful to your agents."
        />
        <StoryDiagram
          src={captureJourney2752}
          srcSet={`${captureJourney1280} 1280w, ${captureJourney2752} 2752w`}
          width={2752}
          height={1116}
          alt="A voice note travels from a phone to Zenod, then into Google Drive and Obsidian as an original and transcript before an agent retrieves it through MCP"
          className="v5-story-diagram-capture"
        />
        <p className="v5-concept-note">
          Conceptual workflow · connected channels and agents vary by plan.
        </p>
      </div>
    </section>
  );
}

export function CultivateStorySection() {
  return (
    <section className="v5-section v5-story-section" id="cultivate">
      <div className="v5-wrap">
        <StoryIntro
          no="03 / CULTIVATE"
          kicker="Extract more intelligence"
          title="Cultivate your context."
          lead="Every layer makes the raw material more useful: evidence preserved, meaning connected, action grounded."
        />
        <StoryDiagram
          src={cultivateContext2752}
          srcSet={`${cultivateContext1280} 1280w, ${cultivateContext2752} 2752w`}
          width={2752}
          height={976}
          alt="A rising layered diagram moves from original evidence through connected meaning to action"
          className="v5-story-diagram-cultivate"
        />
      </div>
    </section>
  );
}

export function GroundingStorySection() {
  return (
    <section className="v5-section v5-story-section" id="grounding">
      <div className="v5-wrap">
        <StoryIntro
          no="04 / GROUNDING"
          kicker="Evidence stays attached"
          title="Keep the original. Connect the meaning."
          lead="Grounded knowledge stays linked to the evidence it came from."
        />
        <StoryDiagram
          src={rawConnected2752}
          srcSet={`${rawConnected1280} 1280w, ${rawConnected2752} 2752w`}
          width={2752}
          height={1116}
          alt="Voice, picture, and text fragments flow through Zenod into a Finding a home collection while source links preserve each original"
          className="v5-story-diagram-grounding"
        />
      </div>
    </section>
  );
}
