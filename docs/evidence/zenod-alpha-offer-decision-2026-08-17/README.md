# Zenod first-alpha offer decision packet

Date: **2026-08-17 CEST**

Issue: [ZAL-3 #1060](https://github.com/zenod-ai/zenod/issues/1060)

Assignment: `ZAL-3-offer-decision-planner`

Decision branch/base: `codex/zal-3-offer-decision` at `0bb5b3df740be9e8f026dba8a19cd9076fb7de44`

Integration target: `main`

Terminal state: **decision-ready; Jordi approval required**

This packet frames the first external alpha contract. It recommends an option but does not approve,
implement, configure, deploy, open signup for, or publish one.

## Recommendation

Recommend **Option A — Managed MCP memory alpha**: offer managed Zenod at the already published
**€5/month or €50/year**, keep self-hosting free and available but outside the managed-alpha onboarding
and acceptance promise, and **exclude WhatsApp from the first-alpha package and launch copy**.

This is the smallest truthful external offer because it matches the current Zenod landing, legal
documents, Stripe price posture, customer layer, and production gate. It asks ZAL-4 and ZAL-5 to prove
one product boundary instead of turning the first Zenod alpha into a coordinated release of Zenod,
Ring, and Phylax. It also avoids promising either of the two still-unproved journeys: a stranger's
clean-machine self-host install and a stranger's version-coherent WhatsApp-to-Zenod memory loop.

Excluding WhatsApp from this offer does not discard the working founder workflow or the product
direction. It keeps that path in private dogfood and evidence work until it has its own onboarding,
support, isolation, and multi-service operational proof.

Jordi remains the decision owner. Nothing in this document changes the current closed-signup state.

## Current evidence boundary

Observed or reconciled on 2026-08-17:

- `main` and this branch's base are `0bb5b3d`, which includes the ZAL-2 grounding correction. The live
  Zenod health endpoint still reports `7365dbc`; the recap fix is therefore merged, not deployed proof.
- [ZAL-1](../zenod-alpha-readiness-2026-08-16/README.md) found the live Zenod service healthy but
  fail-closed: production readiness returned `503`, `ready:false`, `publicPaidSignup:false`, and the
  missing gates were `legal_version`, `stripe_profile`, and `live_billing_journey`.
- The public Zenod product already displays self-hosted free, hosted €5/month, and hosted €50/year.
  Hosted buttons say “opening soon” while the production gate is closed.
- The hosted customer path exists in code: GitHub sign-in, Stripe subscription, GitHub App/repository
  connection, dashboard, tenant-bound MCP URL, and billing portal. It has not passed one uninterrupted
  current stranger journey.
- The self-host path is documented as clone/build/run, setup wizard, GitHub fine-grained PAT, model
  key, and MCP connection. It has not passed the clean-machine 15-minute stranger lap.
- Public hosted support is `jordi@alpha9.io`. The served Terms promise reasonable care and material
  incident communication, explicitly provide no uptime SLA, and make no response-time commitment.
- Phylax health reports WhatsApp connected and receive-ready at `399b3a8`, while live Zenod is at
  `7365dbc`. Earlier founder evidence proves text and voice transport, but its completion audit left
  live two-tenant isolation incomplete. No current stranger pairing/verification → voice capture →
  exact Zenod retrieval journey exists across named, version-coherent Zenod/Ring/Phylax SHAs.
- The Zenod landing does not claim WhatsApp. The current WhatsApp service is a separate Phylax
  surface with its own product and pricing copy, so silently treating it as included Zenod entitlement
  would be a new commercial and operational promise.

Public links rechecked during this decision pass returned the expected status: [Zenod landing](https://zenod.dev/),
[pricing](https://zenod.dev/pricing), [Terms](https://zenod.dev/legal/terms.html),
[Privacy](https://zenod.dev/legal/privacy.html), and [Data Handling](https://zenod.dev/legal/data-handling.html)
returned `200`; [Zenod health](https://cloud.zenod.dev/api/health) returned `200`; the
[public production-readiness endpoint](https://cloud.zenod.dev/api/public/production-readiness)
returned the intentional fail-closed `503`; and [Phylax health](https://phylax.zenod.dev/api/health)
returned `200` with WhatsApp connected/ready.

## Non-negotiable boundary for every option

The first alpha is a **store-only memory product**. Memory writes, evidence capture, vault filing,
search, exact reads, grounded answers, and citations are in scope. The proposed future
**store + execute** lane is explicitly out of scope:

- a stored transcript is evidence, not standing authority to run Codex or mutate a product repo;
- there is no repo/EpicSpine selection, task dispatch, execution status, or hosted result artifact in
  this offer;
- no landing page or invitation may imply that voice notes execute software work;
- any later execution lane needs its own child spine, current-turn user choice, project binding,
  pricing decision, and mutation gates.

## Compact promise matrix

| Promise | A — Managed MCP memory **(recommended)** | B — Free self-host-first | C — Concierge WhatsApp voice memory |
|---|---|---|---|
| Hosted boundary | First-alpha product | Remains closed / not offered | First-alpha product for at most 3 named invitees |
| Self-hosted boundary | Free/open source; available, but outside managed-alpha acceptance and individualized support | The only first-alpha product | Free/open source; outside concierge acceptance/support |
| Exact price | €5/month or €50/year; tax shown at checkout | Free; user pays infrastructure, GitHub/model-provider costs | €5/month; annual purchase deferred; WhatsApp €0 extra during the capped alpha only |
| WhatsApp | Excluded from package, acceptance, and launch copy | Excluded from package, acceptance, and launch copy | Included only for one manually verified sender per accepted account; voice-memory capture/recall, not execution |
| Onboarding | Zenod page → GitHub sign-in → Stripe → connect GitHub repo → copy MCP URL into an agent | Clone/build/run → setup wizard → GitHub PAT + model key → copy MCP connection | Option A monthly path → scheduled verified-sender setup → phone voice-memory acceptance lap |
| Support promise | Email at `jordi@alpha9.io`; reasonable care/material incident communication; no uptime or response-time SLA | Docs + public GitHub issues, best effort; no individualized setup, uptime, or response-time promise | One scheduled setup plus hosted email support; best effort; no uptime or response-time SLA |
| Landing promise | Managed memory for MCP agents; customer-owned GitHub vault; beta; exact prices; no WhatsApp | Open-source memory agent you run; customer-owned vault; free; hosted beta stays “opening soon” | Invite-only hosted voice-memory alpha; one verified sender; capped cohort; no general/self-serve WhatsApp claim |
| Operational prerequisite | Zenod-only ZAL-4 gate and hosted ZAL-5 journey | Reproducible image/install docs and clean-host self-host ZAL-5 journey | Zenod + Ring + Phylax candidate SHAs, entitlement/billing wording, channel session/runbook, and full phone journey |
| ZAL-6 posture | Focused managed-memory invitation | Open-source/self-host adopter invitation | Individually targeted concierge invitation only |

## Option A — Managed MCP memory alpha (recommended)

### Exact customer contract

- **Hosted/self-hosted boundary:** the paid alpha is the shared, tenant-isolated hosted Zenod service.
  The AGPL self-hosted product remains freely available, but its installation is not part of the paid
  alpha onboarding, hosted support promise, or ZAL-5 acceptance lap.
- **Price posture:** keep the public and configured prices unchanged: €5/month or €50/year, with tax
  disclosed at Stripe checkout. The hosted beta Terms, portal, cancellation flow, and 14-day first-
  subscription refund policy apply. No WhatsApp or execution entitlement is bundled.
- **WhatsApp:** explicitly excluded from the offer, landing promise, onboarding, ZAL-5 acceptance, and
  ZAL-6 invitation. Private founder dogfood may continue without becoming customer entitlement.
- **Onboarding:** public pricing → GitHub sign-in → Stripe checkout → GitHub App/repository connection
  → tenant dashboard → copy the authenticated MCP URL into Claude, Codex, or another MCP client. The
  accepted journey must prove store, newest-first search, exact get, grounded ask, and billing portal.
- **Support:** `jordi@alpha9.io` for hosted support/refunds; reasonable care and communication of
  material incidents; no uptime SLA and no guaranteed response time. Do not promise live chat,
  onboarding calls, or 24/7 response.
- **Landing promise:** “Managed Zenod gives MCP-connected agents one evidence-backed memory in a plain
  Markdown GitHub repository you own. Hosted beta is €5/month or €50/year.” The final copy may be
  shorter, but must preserve beta status, repo ownership, prices, and no-WhatsApp boundary.

### Required proof and downstream implications

- **ZAL-4:** pin the Zenod target and rollback image digests; deploy the merged recap correction only
  after approval; acknowledge the served legal version; verify Stripe profile; run the separately
  approved real-card journey; retain restore evidence; keep public signup closed until the final gate.
- **ZAL-5:** one stranger completes page → GitHub → checkout → repo → MCP store/search/get/ask →
  isolation negatives → portal → support discovery on one named deployed SHA. No WhatsApp or
  clean-machine self-host lap is needed for this offer.
- **ZAL-6:** draft a managed-memory alpha invitation that links to the proved hosted path, names beta
  status and the exact price, and makes no voice, WhatsApp, or execution claim.

### Tradeoffs

- **Best:** smallest proof surface; nearly all commercial/public structures already match; keeps the
  story focused on Zenod's core memory contract.
- **Cost:** does not market the founder's most vivid pocket/voice workflow yet; self-host users receive
  documentation rather than alpha concierge support.
- **Residual risk:** annual beta purchase creates a longer customer expectation even with the stated
  refund/cancellation terms. Jordi may later retire the annual option, but doing so is a separate
  pricing choice, not implied by this recommendation.

## Option B — Free self-host-first alpha

### Exact customer contract

- **Hosted/self-hosted boundary:** the external alpha is only the AGPL self-hosted Zenod container.
  Hosted Zenod stays fail-closed and continues to say “Hosted beta opening soon”; no real-card or
  public-signup gate is exercised for launch.
- **Price posture:** Zenod software is free. Users provide and pay for their own server, GitHub account,
  and model-provider key. No hosted monthly/yearly plan is sold during this first alpha.
- **WhatsApp:** excluded. The alpha promise covers the Zenod web setup and MCP memory interface only,
  even if repository code or founder infrastructure contains channel components.
- **Onboarding:** clone the repository, build and run one container with a durable volume, finish the
  setup wizard, connect a GitHub vault using a fine-grained PAT, add a model key, and install the MCP
  URL/token in an agent.
- **Support:** install documentation and the public GitHub issue tracker, best effort, with no
  individualized setup, uptime, or response-time commitment. Hosted Terms/refund language does not
  apply because there is no hosted subscription.
- **Landing promise:** “Run the open-source Zenod memory agent on your own infrastructure for free;
  your vault and keys remain yours.” Hosted pricing may remain visible only as closed future beta.

### Required proof and downstream implications

- **ZAL-4:** no production deploy, Stripe drill, or signup opening is required for this offer. The
  existing hosted gate remains closed. The delivery manager would need to reconcile ZAL-4's role in
  the child-spine dependency chain; this planner must not edit that spine.
- **ZAL-5:** replace the hosted stranger journey with a clean-machine self-host install, setup, MCP
  store/search/get/ask, restart/persistence, backup/export, and support-discovery lap against an exact
  image/commit. The current `docker build` path must be accepted as the distribution posture or a
  versioned image must be proved before invitation.
- **ZAL-6:** target technical early adopters who can run Docker; link to the exact tested install path;
  do not invite non-technical users into a managed flow that remains closed.

### Tradeoffs

- **Best:** no production billing or shared-tenant operational exposure; strongest custody story;
  useful feedback can begin while hosted gates remain closed.
- **Cost:** materially smaller audience; requires server, GitHub PAT, and model-key competence; does not
  test the hosted product the existing alpha spine was designed to launch.
- **Residual risk:** the documented self-host flow has not been walked by a stranger on a clean host,
  and building locally from the repository is a weaker consumer distribution path than a pinned image.

## Option C — Capped concierge WhatsApp voice-memory alpha

### Exact customer contract

- **Hosted/self-hosted boundary:** hosted Zenod is the memory service for at most **three named,
  invited alpha accounts**. Self-hosting remains free and public but is outside the concierge offer.
- **Price posture:** €5/month for hosted Zenod; do not offer a new annual commitment during this
  channel-intensive phase. For the capped cohort, WhatsApp onboarding is included at **€0 additional
  charge for the alpha period only**. No post-alpha WhatsApp price is promised.
- **WhatsApp:** included only as one manually verified sender per accepted account, for text/voice
  memory capture, exact retrieval, and grounded recap. No general public pairing, shared-number scale,
  Telegram, SLA, or store+execute promise is included.
- **Onboarding:** invitation and capacity check → GitHub sign-in → monthly Stripe checkout → GitHub
  repository connection → MCP check → one scheduled, human-assisted sender verification/allowlist
  session → live voice note → immutable receipt → exact retrieval → grounded recap.
- **Support:** one scheduled setup session and `jordi@alpha9.io` afterward, best effort, with no uptime
  or response-time SLA. The 14-day first-subscription hosted refund remains available.
- **Landing promise:** no open WhatsApp CTA. A gated page or invitation may say “Invite-only Zenod
  voice-memory alpha: send a voice note from one verified number and retrieve it with evidence.” It
  must state the capped/manual nature and must not imply voice-triggered execution.

### Required proof and downstream implications

- **ZAL-4:** broaden the preflight from Zenod to exact Zenod, Ring, and Phylax images/configuration,
  rollback and channel-session recovery, model/transcription capacity, entitlement wording, and a safe
  plan that does not reset the founder session. The separate public Phylax pricing surface must be
  reconciled so customers are not shown a contradictory second purchase requirement. All production,
  financial, session, and signup mutations still require their named approvals.
- **ZAL-5:** one invited stranger completes the hosted MCP journey plus sender verification, text and
  voice capture, immutable receipt, exact retrieval, grounded recent recap, read-side immutability,
  cross-tenant negative checks, restart/session recovery evidence, portal, and support discovery on
  named, mutually compatible SHAs.
- **ZAL-6:** use direct invitations only, name the maximum cohort and manual onboarding, and avoid a
  general-availability claim. Do not publish until the multi-service acceptance lap passes.

### Tradeoffs

- **Best:** tests the distinctive pocket/voice habit with real users and preserves the strongest
  founder-use narrative.
- **Cost:** converts one Zenod launch into a coordinated three-service support surface; requires human
  onboarding and capacity; current separate Zenod/Phylax commercial surfaces are not a coherent bundle.
- **Residual risk:** live SHAs differ, the recap correction is not deployed, older Phylax evidence did
  not close two-tenant live isolation, and unofficial/session-backed WhatsApp transport carries outage
  and recovery risk. This option is decision-ready but not launch-ready.

## Reversible-safe work while the decision is open

The following may continue without prejudging Jordi's choice:

- prepare a read-only ZAL-4 inventory of current Zenod target/rollback candidates and redacted gate
  requirements, without deploying or changing configuration;
- retain the closed-signup state and current “opening soon” hosted CTA;
- validate the merged recap correction locally and prepare an exact deployment/test plan;
- keep founder WhatsApp dogfood running without resetting sessions or making it a public entitlement;
- draft acceptance checklists for each option, clearly labeled conditional;
- preserve existing public pages and legal documents while checking links and factual drift.

Do **not** change landing copy, prices, Stripe products, checkout eligibility, signup flags, support
language, WhatsApp sessions/allowlists, production configuration, or external posts before the option
and the later action-specific gates are approved.

## The one bounded decision Jordi must answer

> **Which exact first-alpha contract do you approve: A, B, or C?**
>
> - **A (recommended):** hosted MCP memory at €5/month or €50/year; self-host remains free but outside
>   managed-alpha acceptance/support; WhatsApp excluded; hosted email support with no SLA.
> - **B:** self-host-only memory alpha, free software; hosted stays closed; WhatsApp excluded; docs and
>   GitHub-issue support only with no SLA.
> - **C:** at most three invite-only hosted accounts at €5/month; annual deferred; one verified
>   WhatsApp sender included at €0 extra during alpha; one concierge setup; no SLA.

An unambiguous answer is `APPROVE A`, `APPROVE B`, or `APPROVE C`. Any mixed or changed price,
WhatsApp, onboarding, or support promise is a new option and should be restated exactly before ZAL-4,
ZAL-5, or ZAL-6 treats it as approved.

This offer decision does not itself approve production deployment, the live-card drill, opening public
signup, any WhatsApp-session mutation, or external promotion. Those remain separate human gates.

## Evidence and source links

- [Zenod alpha launch spine](../../EPIC-ZENOD-ALPHA-LAUNCH.md) — intent, dependency order, acceptance,
  and human gates; read-only to this assignment.
- [ZAL-1 readiness audit](../zenod-alpha-readiness-2026-08-16/README.md) — current landing, hosted,
  billing, support, self-host, WhatsApp, and operational truth.
- [ZAL-2 recent-recap evidence](../zal-2-recent-recap-2026-08-17/README.md) — recovered failure,
  grounding correction, validation, and merged-not-live boundary.
- [Roadmap](../../ROADMAP.md) — current hosted/self-hosted product split and WhatsApp milestone.
- [Production readiness gate](../../PRODUCTION-READINESS.md) — exact hosted deploy, billing, restore,
  and signup procedure.
- [Zenod README](../../../README.md) — current self-host setup and hosted-beta status.
- [Phylax completion audit](../phylax-ship-2026-07-12/13-completion-audit.md) — live founder text/voice
  proof and incomplete two-tenant/Telegram acceptance.
- [WhatsApp multi-tenant decision](../../WHATSAPP-SHARED-NUMBER-P0.5.md) — historic concierge versus
  shared-routing tradeoff; context only, not current launch proof.
