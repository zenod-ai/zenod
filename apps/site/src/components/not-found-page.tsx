// ZAL-A19: the page for an unknown path on zenod.dev and cloud.zenod.dev, sent
// with HTTP 404 by the server. Links are absolute so they work on both hosts.
import "@/paper.css";

const SITE = "https://zenod.dev";

export function NotFoundPage() {
  return (
    <div className="pp pp-testers pp-not-found">
      <header className="pp-nav">
        <div className="pp-nav-in">
          <a className="pp-brand" href={`${SITE}/`} aria-label="Zenod home">
            Zenod
          </a>
        </div>
      </header>
      <main id="top">
        <section className="pp-testers-hero" aria-labelledby="not-found-title">
          <p className="pp-fine">404</p>
          <h1 id="not-found-title">This page does not exist.</h1>
          <p className="pp-lead">
            The link may be old or mistyped. Here is where you can go instead.
          </p>
          <p className="pp-actions">
            <a className="pp-btn pp-btn-primary" href={`${SITE}/`}>
              Zenod home
            </a>
            <a className="pp-btn" href="https://cloud.zenod.dev/app">
              Open your library
            </a>
          </p>
          <p className="pp-not-found-links">
            <a href={`${SITE}/connect`}>Connect your AI tools</a>
            <a href={`${SITE}/pricing`}>Pricing</a>
            <a href={`${SITE}/testers`}>Testers</a>
          </p>
        </section>
      </main>
    </div>
  );
}
