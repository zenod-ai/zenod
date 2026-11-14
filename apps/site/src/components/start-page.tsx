// zenod.dev/start (E26-S26): the page a new tester's WhatsApp message and thank-you
// email link to. The 60-second video of five things to try, the same five in
// words, and the four steps that link WhatsApp. The video file is served by the
// site itself (apps/site/public/start/), so it streams in the browser.
import * as React from "react";

export const START_VIDEO_SRC = "/start/zenod-start.mp4";
export const START_POSTER_SRC = "/start/zenod-start.jpg";

export const FIVE_THINGS: { title: string; text: string }[] = [
  { title: "Drop a voice note", text: "on WhatsApp, the way you would leave yourself one. Zenod answers Saved." },
  { title: "Find your own copy", text: "word for word, in your Google Drive or GitHub, in the Log folder." },
  { title: "Ask it back", text: "in the app's chat: what did I say about…?" },
  { title: "Use it from Claude or ChatGPT", text: "add Zenod once at zenod.dev/connect, then ask there." },
  { title: "See your memory graph", text: "your notes as topics and links, in the app." },
];

export function StartPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="pp pp-testers pp-start">
      {nav}
      <main id="top">
        <section className="pp-start-hero" aria-labelledby="start-title">
          <h1 id="start-title">Start with Zenod in one minute</h1>
          <video
            className="pp-start-video"
            controls
            playsInline
            preload="metadata"
            poster={START_POSTER_SRC}
            src={START_VIDEO_SRC}
          >
            <a href={START_VIDEO_SRC}>Watch the one-minute video</a>
          </video>
        </section>

        <section className="pp-start-block" aria-labelledby="five-title">
          <h2 id="five-title">Five things to try</h2>
          <ol className="pp-start-five">
            {FIVE_THINGS.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b> {item.text}
              </li>
            ))}
          </ol>
        </section>

        <section className="pp-start-block" aria-labelledby="wa-title">
          <h2 id="wa-title">Link WhatsApp</h2>
          <ol>
            <li>
              Open <a href="https://cloud.zenod.dev/app">cloud.zenod.dev/app</a> and go to Settings.
            </li>
            <li>Type your WhatsApp number and press Create one-time code.</li>
            <li>Send the code to the Zenod number shown there.</li>
            <li>Send your first voice note.</li>
          </ol>
        </section>

        <section className="pp-start-block">
          <p>
            Questions? Write to <a href="mailto:jordi@zenod.dev">jordi@zenod.dev</a>.
          </p>
          <p className="pp-fine">
            <a href="https://cloud.zenod.dev/app">Your Zenod app</a> · <a href="/connect">Connect Claude or ChatGPT</a> ·{" "}
            <a href="/testers">The tester page</a>
          </p>
        </section>
      </main>
      {footer}
    </div>
  );
}
