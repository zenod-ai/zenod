import illustration640 from "@/assets/story/slide-01/ownership-illustration-640.webp";
import illustration1280 from "@/assets/story/slide-01/ownership-illustration-1280.webp";
import illustrationJpg from "@/assets/story/slide-01/ownership-illustration-1280.jpg";
import "./slide-01-story.css";

export function SlideOneStorySection() {
  return (
    <section className="v5-section v5-story-section v5-slide-section" id="ownership">
      <div className="v5-wrap">
        <div className="v5-story-intro">
          <span className="v5-section-no">01 / OWNERSHIP</span>
          <p className="v5-kicker">Your account starts here</p>
          <h2>
            Your memory. <span className="v5-cyan">Your library.</span>{" "}
            <span className="v5-acid">Your librarian.</span>
          </h2>
          <p className="v5-lead">
            Zenod is not your memory. It is the librarian that stores,
            organizes, and connects it to your agents.
          </p>
        </div>
      </div>

      <div className="v5-wrap v5-story-illustration">
        <figure>
          <picture>
            <source
              type="image/webp"
              srcSet={`${illustration640} 640w, ${illustration1280} 1280w`}
              sizes="(max-width: 760px) calc(100vw - 24px), min(1240px, calc(100vw - 40px))"
            />
            <img
              src={illustrationJpg}
              width={1280}
              height={714}
              loading="eager"
              decoding="async"
              alt="Multiple entry points feed one Zenod librarian, which maintains originals and connected knowledge in the user's account."
            />
          </picture>
          <figcaption>
            <span>ONE GATEKEEPER</span>
            <strong>Entry points in. Organized memory out.</strong>
          </figcaption>
        </figure>
      </div>

      <div className="v5-wrap v5-story-detail-grid">
        <article>
          <span className="v5-panel-label">YOUR ENTRY POINTS</span>
          <h3>Meet the work where it happens.</h3>
          <p>
            Voice notes, agents, and connected tools bring context into one
            organized system.
          </p>
        </article>
        <article>
          <span className="v5-panel-label">THE LIBRARIAN</span>
          <h3>One controlled writer.</h3>
          <p>
            Zenod preserves the original, extracts meaning, and keeps the
            index connected.
          </p>
        </article>
        <article>
          <span className="v5-panel-label">YOUR ACCOUNT</span>
          <h3>The library stays yours.</h3>
          <p>
            Originals and connected Markdown live in your GitHub vault or
            Google Drive.
          </p>
        </article>
      </div>
    </section>
  );
}
