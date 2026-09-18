import entryPoints640 from "@/assets/story/slide-01/items/entry-points-640.webp";
import entryPoints1280 from "@/assets/story/slide-01/items/entry-points-1280.webp";
import librarian640 from "@/assets/story/slide-01/items/librarian-640.webp";
import librarian1280 from "@/assets/story/slide-01/items/librarian-1280.webp";
import account640 from "@/assets/story/slide-01/items/account-640.webp";
import account1280 from "@/assets/story/slide-01/items/account-1280.webp";
import "./slide-01-story.css";

function SceneItem({
  src640,
  src1280,
  width,
  height,
  alt,
  label,
  title,
  className,
}: {
  src640: string;
  src1280: string;
  width: number;
  height: number;
  alt: string;
  label: string;
  title: string;
  className: string;
}) {
  return (
    <figure className={`v5-own-scene-item ${className}`}>
      <img
        src={src1280}
        srcSet={`${src640} 640w, ${src1280} 1280w`}
        sizes="(max-width: 760px) 80vw, 28vw"
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        alt={alt}
      />
      <figcaption>
        <span>{label}</span>
        <strong>{title}</strong>
      </figcaption>
    </figure>
  );
}

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

      <div className="v5-wrap v5-own-scene">
        <SceneItem
          className="v5-own-scene-item-left"
          src640={entryPoints640}
          src1280={entryPoints1280}
          width={860}
          height={880}
          alt="Illustration of entry points moving toward the Zenod librarian."
          label="YOUR ENTRY POINTS"
          title="Conversations, files, and agents"
        />

        <div className="v5-own-connector" aria-hidden="true" />

        <SceneItem
          className="v5-own-scene-item-center"
          src640={librarian640}
          src1280={librarian1280}
          width={980}
          height={1080}
          alt="The Zenod librarian holding an open book."
          label="THE GATEKEEPER"
          title="Zenod organizes the library"
        />

        <div className="v5-own-connector" aria-hidden="true" />

        <SceneItem
          className="v5-own-scene-item-right"
          src640={account640}
          src1280={account1280}
          width={940}
          height={890}
          alt="Illustration of the user-owned account with originals and connected knowledge."
          label="YOUR ACCOUNT"
          title="Originals and connected meaning"
        />
      </div>

      <div className="v5-wrap v5-story-detail-grid">
        <article>
          <span className="v5-panel-label">CAPTURE</span>
          <h3>Meet the work where it happens.</h3>
          <p>
            Voice notes, files, and connected agents bring context into one
            organized system.
          </p>
        </article>
        <article>
          <span className="v5-panel-label">ORGANIZE</span>
          <h3>One controlled writer.</h3>
          <p>
            Zenod preserves the original, extracts meaning, and keeps the
            index connected.
          </p>
        </article>
        <article>
          <span className="v5-panel-label">OWN</span>
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
