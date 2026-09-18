import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CloudIcon,
} from "lucide-react";

import gateIllustration640 from "@/assets/story/slide-09/librarian-gate-illustration-640.webp";
import gateIllustration1280 from "@/assets/story/slide-09/librarian-gate-illustration-1280.webp";
import gateIllustrationFallback from "@/assets/story/slide-09/librarian-gate-illustration-1280.jpg";
import libraryIllustration640 from "@/assets/story/slide-10/library-threshold-illustration-640.webp";
import libraryIllustration1280 from "@/assets/story/slide-10/library-threshold-illustration-1280.webp";
import libraryIllustrationFallback from "@/assets/story/slide-10/library-threshold-illustration-1280.jpg";
import "./slide-09-10-story.css";

function SectionArt({
  className = "",
  alt,
  sources,
  fallback,
  eager = false,
}: {
  className?: string;
  alt: string;
  sources: { srcSet: string; sizes: string };
  fallback: string;
  eager?: boolean;
}) {
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={sources.srcSet} sizes={sources.sizes} />
      <img
        src={fallback}
        width={1280}
        height={720}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        alt={alt}
      />
    </picture>
  );
}

export function SlideNineStorySection() {
  return (
    <section
      className="v5-section v5-alexandria v5-alexandria-illustrated"
      id="alexandria"
    >
      <div className="v5-wrap v5-alexandria-inner">
        <div className="v5-alexandria-copy">
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

        <figure className="v5-alexandria-illustration">
          <SectionArt
            alt="The librarian Zenodotus at the gate of Alexandria, receiving material from a queue and returning it to a visitor"
            eager
            sources={{
              srcSet: `${gateIllustration640} 640w, ${gateIllustration1280} 1280w`,
              sizes: "(max-width: 960px) 92vw, 52vw",
            }}
            fallback={gateIllustrationFallback}
          />
          <figcaption>
            <b>ZENODOTUS → ZENOD</b>
            <p>Ingestion, organization, and retrieval at one gate.</p>
            <small>CONCEPTUAL ILLUSTRATION · THE LIBRARIAN, NOT THE LIBRARY</small>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function SlideTenStorySection() {
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
          <SectionArt
            className="v5-librarian-art v5-closing-librarian"
            alt="The Alexandrian librarian beside the threshold of a personal library"
            sources={{
              srcSet: `${libraryIllustration640} 640w, ${libraryIllustration1280} 1280w`,
              sizes: "(max-width: 1080px) 92vw, 46vw",
            }}
            fallback={libraryIllustrationFallback}
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
