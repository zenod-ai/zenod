import background640 from "@/assets/story/slide-01/ownership-illustration-640.webp";
import background1280 from "@/assets/story/slide-01/ownership-illustration-1280.webp";
import backgroundJpg from "@/assets/story/slide-01/ownership-illustration-1280.jpg";
import "./slide-01-story.css";

export function SlideOneStorySection() {
  return (
    <section className="v5-section v5-slide-section" id="ownership">
      <div className="v5-wrap v5-slide-scroll">
        <div className="v5-slide-stage" aria-labelledby="slide-01-title">
          <picture className="v5-slide-art">
            <source
              type="image/webp"
              srcSet={`${background640} 640w, ${background1280} 1280w`}
              sizes="(max-width: 760px) 760px, min(1240px, calc(100vw - 40px))"
            />
            <img
              src={backgroundJpg}
              width={1280}
              height={714}
              loading="eager"
              decoding="async"
              alt=""
              aria-hidden="true"
            />
          </picture>

          <div className="v5-slide-overlay">
            <p className="v5-slide-eyebrow">
              GOOD ACCESS STARTS WITH GOOD ORGANIZATION
            </p>

            <h2 className="v5-slide-title" id="slide-01-title">
              <span>Your memory.</span>{" "}
              <span className="v5-slide-cyan">Your library.</span>{" "}
              <span className="v5-slide-lime">Your librarian.</span>
            </h2>

            <p className="v5-slide-verbs">
              <span>STORES.</span>
              <span>ORGANIZES.</span>
              <span>CONNECTS.</span>
            </p>

            <p className="v5-slide-subtitle">
              Zenod is not your memory. It is the librarian that gatekeeps it,
              organizes it, and connects it to your agents.
            </p>

            <div className="v5-slide-gatekeeper">
              <span>This is your 24/7</span>
              <span>memory gatekeeper.</span>
            </div>
            <strong className="v5-slide-gatekeeper-name">ZENOD</strong>
            <small className="v5-slide-gatekeeper-note">
              Organizes, connects, maintains
            </small>

            <p className="v5-slide-entry-codex">Codex</p>
            <p className="v5-slide-entry-claude">Claude</p>
            <p className="v5-slide-entry-other">other agents</p>

            <div className="v5-slide-voice">
              <strong>Voice Note</strong>
              <span>Your ideas, anytime, anywhere</span>
            </div>

            <div className="v5-slide-account-head">
              <strong>YOUR GOOGLE DRIVE ACCOUNT</strong>
              <span>This is your Google Drive account.</span>
            </div>

            <div className="v5-slide-layer v5-slide-layer-knowledge">
              <strong>CONNECTED KNOWLEDGE</strong>
              <div className="v5-slide-layer-chips">
                <span className="v5-slide-chip-index">Index</span>
                <span className="v5-slide-chip-people">People</span>
                <span className="v5-slide-chip-preferences">Preferences</span>
                <span className="v5-slide-chip-open">Open questions</span>
              </div>
            </div>

            <div className="v5-slide-layer v5-slide-layer-originals">
              <strong>ORIGINALS</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
