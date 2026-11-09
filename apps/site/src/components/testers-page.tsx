// zenod.dev/testers (ZAL-A13): the testers program in the Paper style. Jordi,
// 2026-11-08: open the program and the apply form now, first 10 picked by hand.
// The offer is the one EPIC-7 runs: a personal code for a free month of Hosted
// at €0 with no card, extended month by month, usage capped. Answers go to a
// private file on the server, never to a repo or a public page.
import * as React from "react";

import { countSignup } from "@/lib/counter";
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

export function TestersPage({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="pp pp-testers">
      {nav}
      <main id="top">
        <section className="pp-testers-hero" aria-labelledby="testers-title">
          <h1 id="testers-title">Test Zenod with us.</h1>
          <p className="pp-lead">
            Zenod is a librarian for your memory: voice notes on WhatsApp and
            your AI tools over MCP, kept as plain Markdown you own. We are
            letting in our first testers now, and we pick the first ten by
            hand from what you tell us below.
          </p>
        </section>

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
            <h2>What you get</h2>
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
