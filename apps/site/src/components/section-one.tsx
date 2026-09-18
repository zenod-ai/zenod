import sectionLibrarian640 from "@/assets/story/section-01-librarian-640.webp";
import sectionLibrarian1280 from "@/assets/story/section-01-librarian-1280.webp";
import "./section-one.css";

function DriveMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 4 6 0 6 10-3 5H6l-3-5 6-10Z" />
      <path d="M9 4 3 14M15 4l6 10M6 19l6-10 6 10" />
    </svg>
  );
}

function PhoneMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10 18.5h4" />
      <path d="M9 8.5v4M11 6.8v7.4M13 8.1v5.8M15 9.5v3" />
    </svg>
  );
}

function CodexMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7 3.5 12 8 17M16 7l4.5 5-4.5 5M13.5 4 10.5 20" />
    </svg>
  );
}

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7" />
      <circle cx="12" cy="12" r="3.3" />
    </svg>
  );
}

function AgentsMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="m8 11 8-4M8 13l8 4" />
    </svg>
  );
}

const entryPoints = [
  { key: "phone", label: "WhatsApp", detail: "voice note · 5:00", icon: <PhoneMark /> },
  { key: "codex", label: "Codex", detail: "retrieve + write", icon: <CodexMark /> },
  { key: "claude", label: "Claude", detail: "retrieve + write", icon: <ClaudeMark /> },
  { key: "agents", label: "Other agents", detail: "one shared context", icon: <AgentsMark /> },
];

export function SectionOnePrototype() {
  return (
    <section className="z1-section" id="story-01" aria-labelledby="z1-title">
      <div className="z1-copy">
        <p className="z1-eyebrow">01 / YOUR ACCOUNT STARTS HERE</p>
        <h2 id="z1-title">
          <span>Your memory.</span>
          <span className="z1-cyan">Your library.</span>
          <span className="z1-lime">Your librarian.</span>
        </h2>
        <p className="z1-lead">
          Zenod is not your memory. It is the librarian that{" "}
          <strong>stores, organizes, and connects</strong> it to your agents.
        </p>
      </div>

      <div className="z1-diagram">
        <aside className="z1-entry-panel">
          <p className="z1-panel-label">Your entry points</p>
          <div className="z1-entry-list">
            {entryPoints.map((entry) => (
              <div className={`z1-entry z1-entry-${entry.key}`} key={entry.key}>
                <span className="z1-entry-icon">{entry.icon}</span>
                <span className="z1-entry-copy">
                  <strong>{entry.label}</strong>
                  <small>{entry.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="z1-center">
          <div className="z1-flow z1-flow-left" aria-hidden="true">
            <span />
          </div>
          <div className="z1-portrait">
            <img
              src={sectionLibrarian1280}
              srcSet={`${sectionLibrarian640} 640w, ${sectionLibrarian1280} 1280w`}
              sizes="(max-width: 760px) 86vw, (max-width: 1080px) 46vw, 32vw"
              width={2752}
              height={1536}
              decoding="async"
              alt=""
            />
            <div className="z1-portrait-shade" />
          </div>
          <div className="z1-librarian-badge">
            <strong>ZENOD</strong>
            <span>24/7 memory gatekeeper</span>
          </div>
          <div className="z1-flow z1-flow-right" aria-hidden="true">
            <span />
          </div>
        </div>

        <aside className="z1-account">
          <div className="z1-account-head">
            <span className="z1-drive">
              <DriveMark />
            </span>
            <span>
              <strong>YOUR GOOGLE DRIVE ACCOUNT</strong>
              <small>This is your Google Drive account.</small>
            </span>
          </div>

          <div className="z1-layer z1-layer-knowledge">
            <div className="z1-layer-head">
              <strong>CONNECTED KNOWLEDGE</strong>
              <span>index + meaning</span>
            </div>
            <div className="z1-chips">
              <span>Index</span>
              <span>Projects</span>
              <span>People</span>
              <span>Preferences</span>
              <span>Open questions</span>
            </div>
          </div>

          <div className="z1-layer z1-layer-originals">
            <div className="z1-layer-head">
              <strong>ORIGINALS</strong>
              <span>raw evidence</span>
            </div>
            <div className="z1-originals">
              <span>Voice note</span>
              <span>Screenshot</span>
              <span>Document</span>
              <span>Source page</span>
            </div>
          </div>
        </aside>
      </div>

      <p className="z1-footnote">
        It stores. It categorizes. It connects.
      </p>
    </section>
  );
}
