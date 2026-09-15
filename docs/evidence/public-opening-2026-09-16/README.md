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
