# GitHub Auth — The Definitive Runbook (settled 2026-07-02)

Purpose: end this forever. If you are about to create, delete, or reconfigure a GitHub App, or paste
a key/token/PEM anywhere to make the suite write a **code repo**, **stop** — you're chasing a model
that is now officially dead.

> **STANDING RULE (settled 2026-07-02, never reopen).** Archus mines exactly ONE backlog —
> `AlfaBlok/obsidian-brain`. He never writes any other repo. **All other-repo issue writes are
> Epaminon dispatching a worker that uses the runner's existing `gh` auth on the VPS. There is NO
> GitHub App to install for this. M1 is DEAD.** Any doc or test still requiring an App install on a
> code repo encodes the obsolete model and must be corrected on sight.

---

## TL;DR (the whole thing in five lines)

1. **Two separate write paths, on purpose.** Memory/backlog → `AlfaBlok/obsidian-brain` via the
   Console's GitHub App. Everything else (code repos like `zenod-ai/zenod`) → an **Epaminon worker
   running `gh issue create` / `gh` on the VPS**, under the runner's already-authenticated `gh`.
2. **The runner's `gh` already has access to `zenod-ai/zenod`.** No app, no PEM, no PAT-in-env, no
   installation to configure for code repos. It's already authenticated.
3. **The only thing missing is routing** (ticket E-4 "worker-route"): when you ask in chat to open an
   issue in a code repo, the Console still tries its **App token** (which only covers obsidian-brain)
   and returns "GitHub App is not installed." It should instead **dispatch an Epaminon `gh` worker.**
4. **This is a code fix in `zenod-ai/zenod`, not a GitHub-settings or keys task.** That is exactly why
   clicking and key-pasting never worked and never will.
5. **Do not create or delete GitHub Apps to solve code-repo writes.** M1 is dead. The reconnect flow
   also churns apps (`zenod-a9 → zenod-t3 → …`); making new ones only adds noise.

If you do nothing else: **stop touching GitHub Apps for code repos. The fix is E-4 (route code-repo
writes to a `gh` worker). The auth already exists on the runner.**

---

## Why every path you tried failed (so you never retry them)

| What you tried | Why it did nothing |
|---|---|
| Installed `zenod-t3` on the zenod-ai org | Irrelevant to code-repo writes — those go through the runner's `gh`, not an App installation. |
| Granted `zenod-t3` "All repositories" | Same — no App is used for the code path. |
| Pointed the webhook `app.zenod → c1.zenod` | Webhook = event delivery. Never affects write ability. |
| Generated a PEM private key | Not needed anywhere in the settled model. The code path uses the runner's `gh`; the obsidian-brain path already has its credential. |
| Thinking of deleting + recreating the app | App churn (`zenod-a9 → zenod-t3`) is a known noise bug, and code-repo writes don't use an App at all. |

Every one of these was the wrong layer. The blocker is **chat-lane routing (E-4)**: code-repo writes
must dispatch an Epaminon `gh` worker instead of reaching for the Console's obsidian-brain App token.

---

## ⚠️ The one place an App still matters — don't break it

The **Console still uses a GitHub App to write `AlfaBlok/obsidian-brain`** (your memory vault). That
one app is real and load-bearing **for memory only**.

`zenod-t3` is the newest churned app and **may be that live app.** So: **do not delete `zenod-t3`
until you confirm it is not the app writing obsidian-brain.** Check
`github.com/settings/installations` (or `AlfaBlok/obsidian-brain → Settings → GitHub Apps`). Whatever
app has access to obsidian-brain is live — leave it alone. Deleting a leftover churned app is fine;
deleting the live one breaks memory writes.

(For code repos, there is nothing to keep or delete — no App is involved.)

## The fix — one lane, and it's code

**E-4 "worker-route" (in `zenod-ai/zenod`):** the chat-lane handler for "open an issue in `owner/repo`"
must, when `owner/repo` is any repo other than `AlfaBlok/obsidian-brain`, **dispatch an Epaminon
worker that runs `gh issue create --repo <owner>/<repo> …`** under the runner's existing auth — and
**never** call the Console's App token outside obsidian-brain. Same for edits/labels/PRs on code repos.

- Auth: already present (runner's `gh` on the VPS). Nothing to provision.
- Effect: `zenod-ai/zenod` issue creation works from chat; the "GitHub App is not installed" error
  disappears because the App is no longer on that path.
- Caveat: a worker still needs an engine to run. While codex quota is exhausted (until Jul 26) and the
  ephemeral lane has no fallback (ticket E-2), workers may not execute even once routing is fixed. So
  **E-4 (routing) + E-2 (engine fallback)** together fully unblock code-repo writes from chat.

## Interim, until E-4 + E-2 land

Nothing lost: Archus files durable tracking issues in `AlfaBlok/obsidian-brain` naming
`target:<repo>` (this is why iteration-2 epics #228–#236 are "filed, blocked"). When E-4 + E-2 deploy,
those dispatch to `gh` workers and land in the real repos. No GitHub-settings work required from you
in the meantime.

---

## The access reality (why *you* kept getting stuck)

You were handed a **code/routing task disguised as a GitHub-settings task.** Installing apps, granting
repo access, pasting PEMs — none of it could ever move a routing bug that lives in the Console's
source. The real work is in `zenod-ai/zenod` (E-4), done by a developer or by Epaminon once it can run.
It is **not** yours to hand-crank in the GitHub UI.

## Decision tree — "never again"

```
Need the suite to write a repo?
│
├─ Is it AlfaBlok/obsidian-brain (memory/backlog)?
│   └─ Uses the Console's GitHub App. Works today. Don't delete that app.
│
├─ Is it any OTHER repo (zenod-ai/zenod, nectary, …)?
│   └─ It must go through an Epaminon `gh` worker (runner's existing auth).
│      If it fails → it's the E-4 routing bug (Console wrongly used its App token).
│      Do NOT install/create/delete a GitHub App. Do NOT paste a PEM/PAT. Fix routing.
│
└─ Tempted to "reconnect GitHub" / "make a fresh app" for a code repo?
    └─ STOP. There is no App on the code path. M1 is dead. You'd only churn zenod-t4/t5.
```

## Glossary (because these got conflated all week)

- **Runner `gh` auth**: the GitHub CLI already logged in on the VPS runner. This is what writes code
  repos, via Epaminon workers. No setup needed.
- **Console GitHub App**: writes `obsidian-brain` only. The one app that still matters — for memory.
- **App private key (.pem) / OAuth client secret / webhook URL**: none of these are on the code-repo
  write path. Ignore them for this problem.
- **Installation**: only relevant to the obsidian-brain App path. Not relevant to code repos.

## Immediate next steps (in order)

1. **Stop all GitHub-App work for code repos.** M1 is dead.
2. Don't delete `zenod-t3` until you confirm it's not the live obsidian-brain app (safety note above).
3. The real unblock is **E-4 (route code-repo writes to a `gh` worker) + E-2 (engine fallback)** —
   both code, in `zenod-ai/zenod`, done by a dev or by Epaminon once running.
4. Re-run the canary after E-4 deploys (ask the Council to open a test issue in `zenod-ai/zenod`);
   green = done, and iteration-2 epics #228–#236 can be dispatched.
5. Never open the "create a GitHub App / reconnect GitHub" flow for a code repo again.

---

### Superseded model (kept only so nobody resurrects it)

An earlier version of this runbook (and the M1 action across the iteration-1/2 docs) assumed the suite
needed **one web-OAuth GitHub App installed on both `AlfaBlok` and `zenod-ai`**, with C1 minting a
per-owner installation token (ticket #140), and a **PAT-in-C1-env** interim. **This is obsolete.** The
settled 2026-07-02 model uses the **runner's `gh`** for all non-obsidian-brain writes; there is no App
to install and no cross-account installation to resolve for code repos. If you see M1 / "install the
app on zenod-ai" / "PAT in C1 env for code repos" anywhere, it is the dead model — correct it.
