# Public production signup opened — 16 September 2026

Jordi explicitly authorized normal public opening and rejected tester exceptions. The public service now permits ordinary Google registration and live paid checkout.

- Deployed SHA: `83c275234ef719211d20314e1c69e45795425ce2`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:fb75e3a6bc45263166989c6da191d1893717ad7ca2be08985a796103b67536b4`.
- Target: `cloud.zenod.dev`, public service `zenod-mt-fxpzoo`, application `2dkayH_eAur427leH64MT`.
- Build and boot checks passed: https://github.com/zenod-ai/zenod/actions/runs/35033024825
- Runtime/Dokploy delta: GIT_SHA plus `ZENOD_PUBLIC_GOOGLE_SIGNUP=1` and `ZENOD_PUBLIC_PAID_SIGNUP=1`. All other environment values and mounts preserved. No tester list was changed, no synthetic identity was created, and no payment was made by the agent.
- Health confirmed the exact deployed source. Live readiness HTTP 200: ready=true, publicPaidSignup=true, publicGoogleSignup=true, googleSignupReady=true. evidenceReady=false remains truthful for unfinished historical journey checks.
- Fresh unauthenticated `/auth/google/start` redirects to accounts.google.com with the exact production callback and PKCE challenge. No callback state, cookie, token, or credentials were published in this evidence.
- Server build and 51 customer-route/readiness tests passed. Missing Google credentials or Stripe signing secret still blocks opening. New ordinary customers can reach checkout without tester allowlisting or fabricated receipts.
- Earlier-in-task backup, isolated restore, and independent off-server checksum remain the recovery point. Immediately preceding configuration captured outside the repository before this release.

Four journey receipt checks are advisory rather than runtime blockers; they still appear as failed until real evidence exists. OAuth state/PKCE, session validation, payment entitlement/webhook signatures, and tenant isolation are unchanged. A completed Google registration, payment, portal and Drive journey has not been claimed; Jordi can now perform it through the normal production path.

Start: https://cloud.zenod.dev/auth/google/start . Do not reuse a consumed callback URL.

## Promotion-code entry enabled

At the user's explicit request, production Zenod Checkout now sets `allow_promotion_codes: true`. Existing sessions must be replaced by starting a fresh checkout. No coupon, price, entitlement or other product was modified.

- Deployed source: `212bb15729df4841972c02e784299c12b1d5d22d`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:83e7203478257df3d6e023bbce2b11327621ded1dc61751b06b7465879666d87`.
- Build and boot workflow passed: https://github.com/zenod-ai/zenod/actions/runs/35034144359 .
- Server build and 39 customer-layer tests passed, including the checkout parameter assertion.
- Health verified the exact source; deployed compiled customerBilling.js contains the Zenod-scoped promotion-code parameter.
- Live readiness remains ready=true, publicPaidSignup=true, publicGoogleSignup=true, googleSignupReady=true; evidenceReady=false is unchanged.
- Only GIT_SHA changed in the runtime environment. Desired configuration, exact image, mounts and preserved environment were checked after deployment. Prior configuration captured privately for rollback; the same recent verified recovery point applies.
- No synthetic live customer/session or payment was created for verification. The user can validate the visible field in a new normal checkout.

## Account logo and zero-total checkout

User requested repair of the broken account logo and the payment-method requirement on a 100%-discounted checkout. Production now renders the site's Z mark inline in the account header and sets `payment_method_collection: "if_required"` for Zenod subscription checkout. Paid checkouts still collect payment details; existing sessions require a fresh checkout. Coupon terms were not modified.

- Deployed source: `66d96469ffb88078459ccb728e74020cc47e52b0`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:373c9ac16a84bac170d0b36354e93689a3ca67cb4a2fb247579622c935f96516`.
- Build/boot workflow: https://github.com/zenod-ai/zenod/actions/runs/35035158691 — passed.
- Web and server builds passed; 40 customer-layer tests passed, including account activation for both paid and no_payment_required completed sessions.
- Verified exact live health SHA, runtime/Dokploy image, unchanged mounts/environment except GIT_SHA, and signup readiness/flags true.
- Downloaded live app bundle confirms inline Z in the account header. Deployed compiled billing module confirms if_required. No live subscription or payment created by the agent.
- Current pre-release configuration and rollback script captured privately; same recent verified volume recovery point applies.

## Post-checkout portal branding

User confirmed successful checkout and requested the Z mark in the activated portal and removal of the internal usr_ identifier shown as a name. Account and portal now share the same inline Z component. Zenod portal subtitle is “Your hosted workspace” (or self-hosted equivalent); overview introductory text no longer prints the tenant identifier. Other products' branding is preserved.

- Exact production source: `d428c1f659fd0103dc350f030bff00bc5adf5606`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:770909970249c9a6e44a06a70a10eb2d5bcd1e08e1edd18ab6503c17caa4c2a8`.
- Build/boot checks passed: https://github.com/zenod-ai/zenod/actions/runs/35036393925 .
- Web build and five focused edition/overview tests passed.
- Verified exact live health/source, image and preserved environment/mounts; public signup and checkout readiness remain enabled.
- Live portal bundle contains the new subtitle and shared inline Z mark. No customer account, subscription or tenant identifier was changed.

## Drive setup recovery

- Public production source verified by live health: `2a4ff6623fc6efa48355c5e697dd38c9c4833f67`; build/boot workflow https://github.com/zenod-ai/zenod/actions/runs/35040840125 passed.
- Google Drive version metadata caused false publication conflicts. The affected real account's six intended files (four starter files, Git bundle, manifest) were independently downloaded and matched to their intended SHA-256 checksums; manifest binding, transaction and Git commit identity also matched.
- Reconciled the fully applied publication journal to committed, retaining its original revision and private before-state snapshots. No customer files were deleted.
- Normal repository open and a second open from an empty cache succeeded with the same revision; starter schema was complete. Only after these checks was the existing account binding marked ready.
- This proves recovery of the affected account, not completion of all product journeys or a new write journey. Additional unshipped validation changes were set aside at the user's request to minimize scope.
- Continue through https://cloud.zenod.dev/app#vault without the stale setup-error query parameter.
