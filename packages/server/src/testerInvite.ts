// EPIC-26 T1 round 2 (Jordi, 2026-11-10: "you make a click and you go through the
// funnel … use this code at checkout"): one invite link, cloud.zenod.dev/join?code=…,
// carries the tester's code through sign-in straight into Stripe Checkout with the
// code already applied, then a "you're in" page with the two next steps. The code
// only ever travels as a normalized query value; the pages are static HTML.

export const JOIN_PATH = "/join";
export const WELCOME_PATH = "/welcome";

const SIGNUP_COUNTER_URL = "https://signup.alpha9.io/api/public/pv?h=zenod.dev&e=signup";

/** A Stripe promotion code as a tester types it: letters, digits, - and _, 3 to 40 long. */
export function normalizeInviteCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim();
  return /^[A-Za-z0-9_-]{3,40}$/.test(code) ? code : null;
}

export function joinPath(code: string | null, signedUp = false): string {
  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (signedUp) params.set("signed_up", "1");
  const query = params.toString();
  return query ? `${JOIN_PATH}?${query}` : JOIN_PATH;
}

/** The sign-in return path for an invite, rebuilt from its parts, or null when it is not one. */
export function joinReturnPath(value: string | undefined): string | null {
  if (!value || /[\\\r\n]/.test(value)) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== JOIN_PATH || url.hash) return null;
    return joinPath(normalizeInviteCode(url.searchParams.get("code")), url.searchParams.get("signed_up") === "1");
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const PAPER_STYLE = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#f6f2e9;color:#18211c;font:400 1.125rem/1.6 Newsreader,Georgia,"Times New Roman",serif;display:grid;place-items:center;padding:clamp(1.25rem,5vw,3rem)}main{width:100%;max-width:34rem}.brand{font:500 1.5rem Newsreader,Georgia,serif;letter-spacing:-.01em;color:#18211c;text-decoration:none}h1{font-weight:400;font-size:clamp(2rem,6vw,2.75rem);line-height:1.1;letter-spacing:-.02em;margin:1.5rem 0 .75rem}p{margin:0 0 1rem}.muted{color:#4a554e}.sans{font-family:"Instrument Sans",system-ui,sans-serif}ol{margin:1.25rem 0 1.5rem;padding:0;list-style:none;counter-reset:s}ol li{counter-increment:s;position:relative;padding:.85rem 0 .85rem 2.5rem;border-top:1px solid #d9d2c1}ol li:last-child{border-bottom:1px solid #d9d2c1}ol li::before{content:counter(s);position:absolute;left:0;top:.85rem;font:500 .95rem "Instrument Sans",system-ui,sans-serif;color:#1f4d3a}.code{display:inline-block;font:500 .95rem ui-monospace,SFMono-Regular,Menlo,monospace;background:#e9e3d5;padding:.15rem .5rem;border-radius:3px}.buttons{display:grid;gap:.75rem;margin:1.5rem 0}.btn{display:block;text-align:center;text-decoration:none;font:500 1rem "Instrument Sans",system-ui,sans-serif;padding:.9rem 1.25rem;border:1px solid #18211c;color:#18211c;border-radius:3px}.btn.primary{background:#1f4d3a;border-color:#1f4d3a;color:#f6f2e9}.btn:hover{background:#18211c;color:#f6f2e9}.small{font:400 .9rem/1.5 "Instrument Sans",system-ui,sans-serif;color:#4a554e}a{color:#1f4d3a}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><link rel="icon" href="/site/favicon.svg" type="image/svg+xml"><style>${PAPER_STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** The first screen of the invite link: what Zenod is, the three things, and sign-in. */
export function joinPage(code: string | null, providers: Array<"google" | "github">): string {
  const returnTo = encodeURIComponent(joinPath(code));
  const buttons = providers
    .map((provider) =>
      `<a class="btn${provider === "google" ? " primary" : ""}" href="/auth/${provider}/start?return_to=${returnTo}">Continue with ${provider === "google" ? "Google" : "GitHub"}</a>`)
    .join("");
  const codeLine = code
    ? `<p class="small">Your code <span class="code">${escapeHtml(code)}</span> is already in this link. It is applied at checkout for you, so the total is €0 and no card is asked for.</p>`
    : `<p class="small">Have a code? You can add it at checkout.</p>`;
  return page(
    "You're invited to Zenod",
    `<a class="brand" href="https://zenod.dev">Zenod</a>
<h1>You're invited to try Zenod.</h1>
<p>Zenod is a memory you talk to. You get three things:</p>
<ol>
<li>A WhatsApp number for your voice notes.</li>
<li>Your memory, word for word, in your own Google Drive or GitHub.</li>
<li>A knowledge graph of your notes that any AI tool with MCP can read and write.</li>
</ol>
<p class="muted">Sign in to create your account. Then you go straight to checkout.</p>
<div class="buttons">${buttons || `<p class="small">Sign-in is not available right now. Please try again later.</p>`}</div>
${codeLine}
<p class="small">More about testing: <a href="https://zenod.dev/testers">zenod.dev/testers</a></p>`,
  );
}

/** After checkout: the account is ready, and the two steps that make it useful. */
export function welcomePage(signedUp: boolean): string {
  const counter = signedUp
    ? `<img src="${SIGNUP_COUNTER_URL}" width="1" height="1" alt="" referrerpolicy="no-referrer" style="position:absolute">`
    : "";
  return page(
    "You're in — Zenod",
    `<a class="brand" href="https://zenod.dev">Zenod</a>
<h1>You're in.</h1>
<p>Your Zenod account is ready. Two steps and you can start talking to it:</p>
<ol>
<li>Choose where your notes live: your Google Drive or a GitHub repository.</li>
<li>Link your WhatsApp. Type your number in Settings, then send the short code it shows to the Zenod number.</li>
</ol>
<div class="buttons"><a class="btn primary" href="/app#vault">Choose where your notes live</a><a class="btn" href="/app#settings/channels">Link WhatsApp</a></div>
<p class="small">After that, send a voice note like you'd leave yourself one. Zenod writes down every word, files it and replies Saved.</p>
<p class="small">Stuck anywhere? Write to <a href="mailto:support@zenod.dev">support@zenod.dev</a>.</p>${counter}`,
  );
}

/** An invite link that cannot go on right now, in plain words, with the way back. */
export function joinProblemPage(message: string): string {
  return page(
    "Zenod",
    `<a class="brand" href="https://zenod.dev">Zenod</a>
<h1>One moment.</h1>
<p>${escapeHtml(message)}</p>
<p class="small">Nothing was charged. Questions? Write to <a href="mailto:support@zenod.dev">support@zenod.dev</a>.</p>
<div class="buttons"><a class="btn" href="/app">Open Zenod</a></div>`,
  );
}
