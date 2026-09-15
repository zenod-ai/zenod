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
