// zenod.dev/start (E26-S26): the page a new tester's WhatsApp message and thank-you
// email link to. The 60-second video of five things to try, the same five in
// words, the first voice note to send (E7-S47: what to say, before the setup steps) and the
// one-tap steps that link WhatsApp for anyone not linked yet. The video file is served by the
// site itself (apps/site/public/start/), so it streams in the browser.
import * as React from "react";

export const START_VIDEO_SRC = "/start/zenod-start.mp4";
export const START_POSTER_SRC = "/start/zenod-start.jpg";
/** E7-S47: the one thing to say first, the same words as the WhatsApp welcome. */
export const FIRST_NOTE_EXAMPLE = "This week I'm working on...";

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
          <h1 id="start-title">Start with Zenod Memory in one minute</h1>
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

        <section className="pp-start-block" aria-labelledby="first-title">
          <h2 id="first-title">Send your first voice note</h2>
          <p>
            In the Zenod chat on WhatsApp, hold the microphone and say what is on your mind. Try: <q>{FIRST_NOTE_EXAMPLE}</q>{" "}
            Zenod answers Saved and keeps a copy in your own Drive or GitHub.
          </p>
        </section>

        <section className="pp-start-block" aria-labelledby="wa-title">
          <h2 id="wa-title">WhatsApp not linked yet?</h2>
          <ol>
            <li>
              Open <a href="https://cloud.zenod.dev/app">cloud.zenod.dev/app</a> and go to Settings.
            </li>
            <li>Press Open WhatsApp and send the message it fills in.</li>
            <li>Zenod answers that you are linked. Then send your first voice note.</li>
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
