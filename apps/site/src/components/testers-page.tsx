// zenod.dev/testers (ZAL-A13): the testers program in the Paper style. Jordi,
// 2026-11-08: open the program and the apply form now, first 10 picked by hand.
// The offer is the one EPIC-7 runs: a personal code for a free month of Hosted
// at €0 with no card, extended month by month, usage capped. Answers go to a
// private file on the server, never to a repo or a public page. EPIC-26 T1
// (Jordi's voice note, 2026-11-10): the three things a tester gets come first,
// each with a real screen: the WhatsApp number, the word-for-word copy in their
// own Drive or GitHub, and the linked graph any AI tool reads and writes over MCP.
import * as React from "react";

import log from "@/assets/shots/log.webp";
import logPhone from "@/assets/shots/log-phone.webp";
import graphLive from "@/assets/shots/graph-live.webp";
import graphLivePhone from "@/assets/shots/graph-live-phone.webp";
import { WhatsappScene } from "@/components/paper-landing";
import { countSignup } from "@/lib/counter";
import { startScenes } from "@/lib/scenes";
import { submitTesterApplication, TESTERS_QUESTION } from "@/lib/testers";

type Status = "idle" | "sending" | "sent" | "error";

function ApplyForm() {
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");
    setError(null);
    try {
      await submitTesterApplication({
        use: String(form.get("use") ?? ""),
        contact: String(form.get("contact") ?? ""),
        website: String(form.get("website") ?? ""),
      });
      countSignup();
      setStatus("sent");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your application.");
      setStatus("error");
    }
  };

  if (status === "sent")
    return (
      <div className="pp-apply pp-apply-sent" role="status">
        <h3>Thank you, your application is in.</h3>
        <p>
          We read every answer ourselves. If you are one of the first ten, we
          write to you with your personal code.
        </p>
      </div>
    );

  return (
    <form className="pp-apply" onSubmit={onSubmit} aria-labelledby="apply-title">
      <label htmlFor="tester-use">{TESTERS_QUESTION}</label>
      <textarea
        id="tester-use"
        name="use"
        rows={5}
        required
        minLength={10}
        maxLength={2000}
        placeholder="For example: voice notes on my walks, and Claude Code saving what we work out on my side project."
      />
      <label htmlFor="tester-contact">Where can we reach you?</label>
      <input
        id="tester-contact"
        name="contact"
        type="text"
        required
        minLength={3}
        maxLength={200}
        autoComplete="email"
        placeholder="Email, or your Reddit or X handle"
      />
      <div className="pp-apply-trap" aria-hidden="true">
        <label htmlFor="tester-website">Leave this empty</label>
        <input id="tester-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <p className="pp-apply-actions">
        <button className="pp-btn pp-btn-primary" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Apply to test Zenod"}
        </button>
      </p>
      {error ? <p className="pp-fine pp-error">{error}</p> : null}
      <p className="pp-fine">
        Your answer stays with the Zenod team and is never published. We use
        your contact only to write to you about testing.
      </p>
    </form>
  );
}

function Promises() {
  return (
    <section className="pp-testers-get" aria-labelledby="get-title">
      <h2 id="get-title">What you get</h2>
      <ol className="pp-promises">
        <li className="pp-promise">
          <div className="pp-promise-say">
            <span className="pp-promise-n" aria-hidden="true">1</span>
            <h3>A WhatsApp number for your voice notes.</h3>
            <p>
              Link your WhatsApp once. Then talk to the Zenod number the way you
              would leave yourself a note. It writes down every word, files it
              and replies Saved.
            </p>
          </div>
          <figure className="pp-promise-fig pp-promise-wa">
            <WhatsappScene />
            <figcaption>A voice note and its two replies, with demo content.</figcaption>
          </figure>
        </li>
        <li className="pp-promise">
          <div className="pp-promise-say">
            <span className="pp-promise-n" aria-hidden="true">2</span>
            <h3>Your memory, word for word, in your own account.</h3>
            <p>
              Everything you send is written into plain Markdown files in your
              own Google Drive or GitHub. Nothing to export later: the copy is
              yours from the first note, and Zenod never edits an entry once it
              is written.
            </p>
          </div>
          <figure className="pp-promise-fig">
            <picture className="pp-stage">
              <source media="(max-width: 560px)" srcSet={logPhone} width={760} height={1968} />
              <img
                src={log}
                width={1840}
                height={1518}
                loading="lazy"
                alt="A day’s log file in a GitHub repository: dated entries, each with its source and the words quoted unchanged"
              />
            </picture>
            <figcaption>The day’s log in your own GitHub repository.</figcaption>
          </figure>
        </li>
        <li className="pp-promise">
          <div className="pp-promise-say">
            <span className="pp-promise-n" aria-hidden="true">3</span>
            <h3>A knowledge graph any AI can read and write.</h3>
            <p>
              Zenod files each note on the right topic and links it to related
              memories, strong or weak. Connect Claude, ChatGPT, Cursor, VS Code
              or Gemini CLI over MCP, and they search it, read the source and
              save what you work out together.
            </p>
            <p className="pp-fine">
              <a href="/connect">How to connect your AI tool</a>
            </p>
          </div>
          <figure className="pp-promise-fig">
            <picture className="pp-stage">
              <source media="(max-width: 560px)" srcSet={graphLivePhone} width={716} height={1034} />
              <img
                src={graphLive}
                width={1272}
                height={1114}
                loading="lazy"
                alt="The Zenod graph view: one memory in the middle, its topic above, and lines to linked memories drawn strong, medium or weak"
              />
            </picture>
            <figcaption>The graph view in the Zenod app, with demo memories.</figcaption>
          </figure>
        </li>
      </ol>
    </section>
  );
}

export function TestersPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  React.useEffect(() => startScenes(document), []);
  return (
    <div className="pp pp-testers">
      {nav}
      <main id="top">
        <section className="pp-testers-hero" aria-labelledby="testers-title">
          <h1 id="testers-title">Test Zenod with us.</h1>
          <p className="pp-lead">
            Zenod is a librarian for your memory. We are letting in our first
            testers now, and we pick the first ten by hand from what you tell
            us below. Here is what you get.
          </p>
        </section>

        <Promises />

        <section className="pp-testers-terms" aria-label="What testing means">
          <div>
            <h2>What you give</h2>
            <p>
              Use Zenod for real for a few weeks: send it voice notes, connect
              Claude, ChatGPT or Cursor, and ask them what you saved.
            </p>
            <p>When something breaks or confuses you, send us a line.</p>
          </div>
          <div>
            <h2>What it costs</h2>
            <p>
              A free month of Zenod Hosted, with WhatsApp and managed AI usage
              included. No card needed.
            </p>
            <p>
              We extend it month by month while you test. Usage is capped each
              month, like every Hosted account.
            </p>
          </div>
        </section>

        <section className="pp-testers-steps" aria-labelledby="steps-title">
          <h2 id="steps-title">How it works</h2>
          <ol>
            <li>Apply below. It takes a minute.</li>
            <li>We read every answer and write to the first ten with a personal code.</li>
            <li>
              Sign in with Google or GitHub, choose Hosted and enter your code at
              Stripe checkout. You pay €0 and no card is asked for.
            </li>
            <li>
              Pick Google Drive or GitHub for your memory, link your WhatsApp in
              Settings, and send your first voice note.
            </li>
          </ol>
        </section>

        <section className="pp-testers-apply" id="apply" aria-labelledby="apply-title">
          <h2 id="apply-title">Apply to test</h2>
          <ApplyForm />
        </section>
      </main>
      {footer}
    </div>
  );
}
