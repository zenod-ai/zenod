// zenod.dev/testers (ZAL-A13): the testers program in the Paper style. Jordi,
// 2026-11-08: open the program and the apply form now, first 10 picked by hand.
// The offer is the one EPIC-7 runs: a personal code for a free month of Hosted
// at €0 with no card that ends by itself; more free months only when we add them, one at a time, never
// automatically, and never charged by itself (EPIC-26 S5 round 3, Jordi's E26-A7 answer), usage capped. Answers go to a
// private file on the server, never to a repo or a public page. EPIC-26 T1
// (Jordi's voice note, 2026-11-10): the three things a tester gets come first,
// each with a real screen: the WhatsApp number, the word-for-word copy in their
// own Drive or GitHub, and the linked graph any AI tool reads and writes over MCP.
// T1 round 2: a tester's code travels in one link. zenod.dev/testers?code=… shows
// the page with a "Start with your code" button to cloud.zenod.dev/join?code=…,
// which signs them in and opens Stripe Checkout with the code already applied.
import * as React from "react";

import log from "@/assets/shots/log.webp";
import logPhone from "@/assets/shots/log-phone.webp";
import graphLive from "@/assets/shots/graph-live.webp";
import graphLivePhone from "@/assets/shots/graph-live-phone.webp";
import { WhatsappScene } from "@/components/paper-landing";
import { countSignup } from "@/lib/counter";
import { startScenes } from "@/lib/scenes";
import {
  fetchTesterLink,
  inviteCodeFromSearch,
  joinUrl,
  rememberedTester,
  rememberTester,
  submitTesterApplication,
  TESTERS_QUESTION,
  type TesterApplyStatus,
} from "@/lib/testers";

type Status = "idle" | "sending" | "sent" | "error";

// E26-S11 iteration 4 (Jordi, 2026-11-12: "test with testers, not with fucking API keys"): the
// tester link on screen is the way in. This browser keeps it, so coming back to this page shows it
// again; a slow code is fetched with the browser's own private key, never by email address.
function TesterLink({ link }: { link: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <h3>You're in. Your tester link:</h3>
      <p className="pp-apply-link">
        <a href={link}>{link}</a>
      </p>
      <p className="pp-apply-actions">
        <a className="pp-btn pp-btn-primary" href={link}>
          Open it now
        </a>{" "}
        <button className="pp-btn" type="button" onClick={copy}>
          {copied ? "Copied" : "Copy the link"}
        </button>
      </p>
      <p>
        It also works later: this page keeps it in this browser, and the link
        works once, only for you, for 14 days. Sign in with Google or GitHub,
        and checkout shows €0 with no card.
      </p>
    </>
  );
}

function ApplyForm() {
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<TesterApplyStatus>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [claim, setClaim] = React.useState<string | null>(null);
  const [again, setAgain] = React.useState(false);

  // Coming back in the same browser: show the link it kept.
  React.useEffect(() => {
    const kept = rememberedTester();
    if (!kept) return;
    setOutcome("accepted");
    setLink(kept.link);
    setClaim(kept.claim);
    setStatus("sent");
  }, []);

  // Accepted but the code is still being made: ask again with this browser's own key.
  React.useEffect(() => {
    if (status !== "sent" || outcome !== "accepted" || link || !claim) return;
    let tries = 0;
    let stopped = false;
    const check = async () => {
      tries += 1;
      const found = await fetchTesterLink(claim).catch(() => null);
      if (stopped) return;
      if (found) {
        setLink(found);
        rememberTester({ link: found, claim });
      } else if (tries < 20) timer = window.setTimeout(check, 6000);
    };
    let timer = window.setTimeout(check, 1500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [status, outcome, link, claim]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");
    setError(null);
    try {
      const result = await submitTesterApplication({
        use: String(form.get("use") ?? ""),
        contact: String(form.get("contact") ?? ""),
        website: String(form.get("website") ?? ""),
      });
      countSignup();
      setOutcome(result.status);
      setLink(result.link);
      setClaim(result.claim ?? null);
      setAgain(Boolean(result.again));
      if (result.status === "accepted" && (result.link || result.claim))
        rememberTester({ link: result.link, claim: result.claim ?? null });
      setStatus("sent");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your application.");
      setStatus("error");
    }
  };

  if (status === "sent")
    return (
      <div className="pp-apply pp-apply-sent" role="status">
        {outcome === "waitlist" ? (
          <>
            <h3>Thank you. The first ten places are taken.</h3>
            <p>
              We kept your application and your email. If a place opens, we
              write to you, and you are first in line for the next round.
            </p>
          </>
        ) : link ? (
          <TesterLink link={link} />
        ) : claim ? (
          <>
            <h3>You're in. Your tester link is being made.</h3>
            <p>
              It appears right here in a moment. If you close this page, open
              zenod.dev/testers again in this browser and it is here.
            </p>
          </>
        ) : again ? (
          <>
            <h3>You applied before with this email.</h3>
            <p>
              Your place is kept. Your tester link shows on this page in the
              browser you applied from. On another device? Write to{" "}
              <a href="mailto:support@zenod.dev">support@zenod.dev</a> from
              that email and we send it to you.
            </p>
          </>
        ) : (
          <>
            <h3>You're in. Thank you for applying.</h3>
            <p>
              Your place is kept. Write to{" "}
              <a href="mailto:support@zenod.dev">support@zenod.dev</a> from
              this email and we send you your tester link.
            </p>
          </>
        )}
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
      <label htmlFor="tester-contact">Your email</label>
      <input
        id="tester-contact"
        name="contact"
        type="email"
        required
        minLength={3}
        maxLength={200}
        autoComplete="email"
        placeholder="you@example.com"
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
        your email only to write to you about testing. If you are in, your
        tester link shows right here, no email to wait for.
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
  const code = inviteCodeFromSearch(typeof window === "undefined" ? undefined : window.location?.search);
  return (
    <div className="pp pp-testers">
      {nav}
      <main id="top">
        <section className="pp-testers-hero" aria-labelledby="testers-title">
          <h1 id="testers-title">Test Zenod with us.</h1>
          <p className="pp-lead">
            Zenod is a librarian for your memory. We are letting in our first
            ten testers now. Apply below with your email, and while places are
            open you are in straight away. Here is what you get.
          </p>
          {code ? (
            <div className="pp-testers-code">
              <p>
                You have a tester code. It is already in this button: sign in,
                and checkout opens with it applied. You pay €0 and no card is
                asked for.
              </p>
              <a className="pp-btn pp-btn-primary" href={joinUrl(code)}>
                Start with your code
              </a>
            </div>
          ) : null}
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
              The free month ends by itself. If the test is going well, we may
              add more free months, one at a time. That is our choice, never
              automatic. Your Zenod app shows how many free days you have left.
            </p>
            <p>
              Nothing is ever charged unless you choose to pay. When your free
              time ends, your notes stay in your own Drive or GitHub, and you
              can keep going for €9 a month.
            </p>
            <p>
              Usage is capped each month, like every Hosted account. If you
              reach the cap, Zenod tells you on WhatsApp. Answers pause,
              everything you send is still kept, and it all starts again on
              the 1st.
            </p>
          </div>
        </section>

        <section className="pp-testers-steps" aria-labelledby="steps-title">
          <h2 id="steps-title">How it works</h2>
          <ol>
            <li>Apply below with your email. It takes a minute.</li>
            <li>The first ten are in straight away. Each sees a personal tester link right here after applying, with a code inside that works once, only for them. No email to wait for.</li>
            <li>
              Open the link and sign in with Google or GitHub. Checkout opens
              with your code already applied: you pay €0 and no card is asked for.
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
