# Key rotation guide, November 2026: what Jordi does, in order

Written 2026-11-02 for EPIC-7 ask E7-A10 (ticket T3.3). Short version first, details after.

> **Superseded for doing it: use the one page.** Open <http://100.104.206.10:8783/> (tailnet only; EPIC-7 T3.4).
> It has all five keys in one sitting, a link and a paste box per step, and live status. The agent checks each key,
> swaps it in, verifies it, and then tells you which old key to revoke. TypeSafe (Jev) is already off. Two changes from
> this guide: the Stripe restricted key also needs **Write** on Subscriptions, Coupons, Promotion Codes and Invoices,
> and **Read** on Payment Methods (the tester codes, the monthly extensions and the daily tester check use them). The
> webhook's old secret should expire in **24 hours**, not 1. This guide stays as the background and the "why".
> Receipts: [T3.4 evidence](../evidence/epic7-t3-4-2026-11-02.md).

## The short version

**Do now: Stripe, about 10 minutes.** Make one restricted key and roll one webhook secret, then paste each into
the private card the agent opens. Agents do the rest and tell you when to switch the old ones off.

**Later, in one sitting within two weeks, about 10 minutes:** the OpenRouter key, the Google sign-in secret and
the GitHub sign-in secret. These are low risk. The reasons are under each step.

**Nothing to do:** TypeSafe. Turning that feature off is a better fix than a new key, and it needs only your
"yes", not a dashboard visit.

You never paste a key into chat, into Dokploy, or into a terminal. Each value goes into a **private secret card**
in the T3 thread, and only the agent's store can read it. Agents can no longer print secrets by accident. See
"How this can't happen again" at the end.

## What leaked, and who could see it (honest version)

On 2026-11-01 one agent run printed Zenod's production settings into its own session output. The keys did not go
public. They were never in git, a website, a log anyone else reads, or a chat with anyone outside. Two places hold
copies:

1. **Agent session transcripts on our own servers (VPS1/VPS3).** Only our agents and root can read them.
2. **The model provider (Anthropic)**, which received that session's text. They keep it under their usual
   retention and access rules and do not publish it.

So the realistic risk is small: someone would have to get into our servers or into the provider's systems first.
The keys below are still rolled, because a live payment key should never sit in a transcript, and because rolling
it is cheap. Agents already rotated Zenod's own internal tokens and the vault key (T3.1, T3.2). The six keys
below can only be changed in their companies' dashboards, which only you can log in to.

| Key | What someone could do with it | Worst case | When |
|---|---|---|---|
| Stripe live secret key (`sk_live`, Zenod account) | Everything the Stripe API allows: read customers, refund, create charges on saved cards, change products | Real money and customer data | **Now** |
| Stripe webhook signing secret | Send fake "payment succeeded" events to Zenod, which could unlock a paid plan without paying | Free plans for a forger | **Now**, same sitting |
| OpenRouter platform key | Run AI calls on our OpenRouter balance | Capped at **$26 a month** by the key's own limit ($24 left today) | Later |
| Google sign-in client secret (stored under two names) | Nothing alone. A thief also needs a login code from a user, and Google sends those codes only to our registered addresses (`cloud.zenod.dev`) | Very low | Later |
| GitHub sign-in client secret (Zenod, Phylax and three other apps share it) | Same as Google: useless without a user's login code, which GitHub sends only to our registered callback | Very low | Later |
| TypeSafe API key | Use our TypeSafe early-access quota | Nothing we pay for | Drop (turn the feature off) |

## Step 1, now: Stripe (about 10 minutes, two cards)

Why this one matters: it is the only leaked key that can move money or read customer data on its own. Zenod uses
your account's **full** secret key today. Zenod needs only three things from Stripe, so we replace the full key
with a **restricted key** that can do those three things and nothing else. That also makes any future leak much
smaller.

Before you start, tell the agent "starting Stripe". It opens two private secret cards in the thread:
`zenod-mt STRIPE_SECRET_KEY` and `zenod-mt STRIPE_WEBHOOK_SECRET`.

### 1a. Create the restricted key (about 5 minutes)

1. Open <https://dashboard.stripe.com/apikeys/create>. Check you are in the **Zenod** account and in **live
   mode** (the "Test mode" switch is off).
2. If Stripe asks how the key will be used, choose **"Providing this key to another website"** or **"Building your
   own integration"**. Either one leads to the permissions list.
3. Name it `zenod-mt 2026-11`.
4. Set these permissions and leave every other one at **None**:
   - **Checkout Sessions: Write**. Zenod creates the checkout page.
   - **Subscriptions: Read**. Zenod checks a customer's plan.
   - **Customer portal: Write**. The "Manage billing" link.
   - **Customers: Read**, **Prices: Read**, **Products: Read**, **Promotion codes: Read**, **Coupons: Read**.
     Checkout reads these for the plan and the tester coupons.
5. Click **Create key**. Stripe shows the key (`rk_live_…`) once. Copy it.
6. Paste it into the card **`zenod-mt STRIPE_SECRET_KEY`** and submit. Do not paste it anywhere else.

### 1b. Roll the webhook signing secret (about 3 minutes)

1. Open <https://dashboard.stripe.com/webhooks>. Stripe may send you to Workbench > Webhooks, which is the same
   page.
2. Click the endpoint whose URL is on **`cloud.zenod.dev`**.
3. Click **"Roll secret"**. When Stripe asks when the old secret should expire, choose **"1 hour"**. That keeps
   real payments flowing while the agent swaps the secret.
4. Click **Reveal** under "Signing secret" and copy the new value (`whsec_…`).
5. Paste it into the card **`zenod-mt STRIPE_WEBHOOK_SECRET`** and submit.
6. Tell the agent **"Stripe pasted"**.

### What the agent does next (about 5 minutes, you wait)

- It stores both values with `secret put zenod-mt … --ref <card> --dokploy --approved E7-A10`. The values go into
  the root-only store and into Dokploy's env. Neither is printed. The guard below would catch them if they were.
- It redeploys `zenod-mt` with `dokploy deploy zenod-mt`. Expect about 30 seconds of downtime.
- It checks, and reports pass or fail for each:
  - live health is ok on the new deploy, and production readiness is still `ready:true`;
  - a checkout session can be created for a test account (an unpaid session, which Stripe expires by itself);
  - the billing portal opens for an existing test customer;
  - the webhook accepts an event signed with the **new** secret, and an event signed with the **old** secret
    is refused once its hour is up.
- If a check fails because a Stripe permission is missing, it tells you which one. You tick it on the key in the
  dashboard, and nothing needs to be pasted again.

### 1c. Switch the old full key off (about 2 minutes, after the agent says "Stripe verified")

1. Open <https://dashboard.stripe.com/apikeys>, still in live mode.
2. Under **Standard keys**, on the **Secret key** row, click the "…" menu and choose **"Roll key…"**. Set
   expiration to **"Now"** and confirm.
3. Stripe shows a new full secret key. **Do not copy it anywhere.** Zenod no longer uses a full key, and no other
   app of ours holds this account's full key (checked in the secret store, 2026-11-02). Close the dialog.
4. Tell the agent **"old Stripe key rolled"**. It confirms checkout still works on the restricted key.

That finishes the urgent part.

## Step 2, later: one sitting within two weeks (about 10 minutes, three cards)

Tell the agent "starting the later keys". It opens three cards:
`zenod-mt ZENOD_PLATFORM_OPENROUTER_KEY`, `zenod-mt GOOGLE_OAUTH_CLIENT_SECRET` and
`zenod-mt GITHUB_OAUTH_CLIENT_SECRET`.

### 2a. OpenRouter (about 3 minutes)

Why later: the key has its own spending limit of $26 a month, so the worst case is $26. We cannot make a new one
for you, because the only key that can create OpenRouter keys is in your Bitwarden vault (item `alpha9-openrouter-provisioning-key`, copied there from the legacy Mac Keychain by infra-vps EPIC-17), not on our servers.

1. Open <https://openrouter.ai/settings/keys>.
2. Click **Create Key**. Name it `zenod-platform 2026-11` and set **Credit limit** to `26` with a **monthly**
   reset, the same as today.
3. Copy the key and paste it into the card **`zenod-mt ZENOD_PLATFORM_OPENROUTER_KEY`**.
4. After the agent says "OpenRouter verified" (it redeploys and runs one AI request), go back to the same page and
   **delete** the old key. It is the one with about $2 of usage this month, not the new one.

### 2b. Google sign-in (about 3 minutes)

Why later: the secret is useless without a login code from one of our users, and Google sends those codes only to
our registered addresses.

1. Open <https://console.cloud.google.com/auth/clients>. Pick the project whose number starts with
   `153584019437`.
2. Open the client whose ID starts with `153584019437-32d9p8q5…`.
3. Click **"Add secret"**. Google keeps the old one working, so nothing breaks. Copy the new secret.
4. Paste it into the card **`zenod-mt GOOGLE_OAUTH_CLIENT_SECRET`**. The agent stores it under both names Zenod
   uses (`GOOGLE_OAUTH_…` and `GOOGLE_OIDC_…`).
5. After the agent says "Google sign-in verified" (it redeploys and signs in with the test account), go back to the
   same client and **disable, then delete** the old secret. It is the older of the two.

### 2c. GitHub sign-in (about 4 minutes)

Why later: same reasoning as Google. One extra wrinkle: five of our apps share this secret (Zenod, Phylax,
Callisthenes, Herald, Ring), so the agent updates all five before you delete the old one.

1. Open <https://github.com/settings/developers>. If the app is not listed there, open
   <https://github.com/organizations/zenod-ai/settings/applications>. Go to **OAuth Apps**, then the app whose
   Client ID is **`Ov23lihBhL9ceTqYWKSP`**.
2. Click **"Generate a new client secret"**. GitHub keeps the old one working. Copy the new secret.
3. Paste it into the card **`zenod-mt GITHUB_OAUTH_CLIENT_SECRET`**.
4. The agent copies it to all five apps with `secret copy … --approved E7-A10`. It redeploys Zenod and Phylax and
   checks GitHub sign-in on both. Callisthenes, Herald and Ring are independent agents, so they get the new value in
   their settings and pick it up at their next restart. Nothing redeploys them automatically.
5. After the agent says "GitHub verified", delete the **old** secret on the same GitHub page.

## TypeSafe: no dashboard step

TypeSafe ("Jev") is an optional shortcut in how Zenod files a capture. When it fails, Zenod already falls back to
its main classifier. Rotating its key buys almost nothing. **Recommendation: answer "yes, turn Jev off".** The
agent sets `ZENOD_JEV_ENABLED=0`, removes `TYPESAFE_API_KEY` from production, redeploys and checks that filing still
works. If you want Jev back later, ask for a fresh TypeSafe key then. You can revoke the old key in TypeSafe's
dashboard whenever you happen to be there, but it is optional.

## Total time for you

| When | What | Your time |
|---|---|---|
| Now | Stripe: restricted key + webhook secret, then roll the old full key | about 10 minutes |
| Within two weeks | OpenRouter + Google + GitHub, one sitting | about 10 minutes |
| Never | TypeSafe: answer "turn Jev off" | a few seconds |

## How this can't happen again

The old rule, "agents must never print secrets", lived in instructions. Two agents broke it in one day. It is now
enforced by the machines (EPIC-7 T3.3, built and proven 2026-11-02):

1. **Agents can't easily get the raw Dokploy key any more.** It used to sit in a file every agent could read.
   That file is gone. The only copy is in the root-only secret store.
2. **Agents talk to Dokploy only through a safe `dokploy` command.** It hands back only harmless fields (names,
   ids, status, image), never settings values. The exact call that leaked on 2026-11-01 (`application.stop`) now
   returns nothing secret. New values go in through a private pipe and never come back out.
3. **A guard checks everything an agent's tools show it, on both servers.** It holds a fingerprint of every secret
   we have. Fingerprints are one-way: you cannot get the secret back from one. They are refreshed every 10 minutes
   and after every change. If any tool output contains a known secret, from any command, file or container, the
   guard swaps it for `[REDACTED:<app>/<NAME>]` **before the AI sees it**, so it never reaches the transcript or
   the model provider. You get an alert in the HQ thread naming which key it was.
4. **It is tested, not promised.** A test plants a fake "canary" secret, then repeats the exact mistakes of
   2026-11-01: the Dokploy stop call, `cat` of a settings file, printing a container's environment, the raw
   Dokploy call. It also asks a real AI session to read the canary back. 21 of 21 checks passed: the canary never
   appeared in any output, answer or saved transcript.

What it does **not** cover, so nothing is oversold:

- A key that is not in our secret store (for example one that lives only in your Bitwarden vault) has no fingerprint
  until it is stored. Every key agents use is in the store.
- Codex is installed on VPS1 but not logged in, and no Codex sessions run, so Codex has no guard hooks. If Codex is
  ever used there, add them first. Only Claude Code sessions run on our servers today.
- Agents on VPS1 still have root through `sudo`, which you granted on 2026-10-22 so they can do server work
  themselves. A deliberate agent could still read the store. That is why the guard (point 3) is the safety net:
  even then, the value is swapped out before the AI sees it.
- What the model provider already received on 2026-11-01 cannot be recalled. That is why Stripe gets rolled now.
