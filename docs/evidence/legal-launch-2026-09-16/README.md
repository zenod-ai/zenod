# Zenod launch legal package — 16 September 2026

## Scope and status

Prepared against production source `961793e2f81a5ba6c9fa72636d0e3a6ff1592c5a` in an isolated worktree. This is an implemented legal-document and navigation update, not a declaration of legal compliance. The deployment receipt below records subsequent publication. Public signup settings and tester lists are unchanged.

Pages: Terms, Privacy Policy, Data Handling, Cookies and browser storage, Legal Notice. All use support@zenod.dev. No personal phone, owner home address, date of birth, or owner name was added. Retained corporate name/address and added the company NIF/registry details required for the operator notice. Sign-in and Account now link directly to Terms/Privacy; the site footer also links to Legal Notice/Cookies. Stripe already references the stable Terms/Privacy URLs.

## Identity evidence

- NIF B67371153, VAT format ESB67371153: supplied by Jordi in this task. No claim of current VIES activation was made.
- Official incorporation record: https://www.boe.es/diario_borme/txt.php?id=BORME-A-2019-27-08 — entry 58370, Alpha Analytics S.L., Barcelona, volume 46743, folio 90, section 8, sheet B 529491, initial entry 1, 1 February 2019.
- Later official record confirms the same sheet: https://www.boe.es/diario_borme/txt.php?id=BORME-A-2022-42-08 — entry 92734. It is a later entry on folio 91; the notice clearly labels initial entry 1.
- Company address matches existing Stripe business details and the incorporation record. Private owner details were not reused.

## Policy/source review

- Spanish LSSI Article 10, company name/address/email, registry and NIF: https://www.boe.es/eli/es/l/2002/07/11/34
- GDPR transparency requirements: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Google API data/limited-use disclosure: https://developers.google.com/terms/api-services-user-data-policy
- Google Workspace policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Cookie inventory grounded in customerSession.ts, customerLayer.ts, site plan sessionStorage, theme-provider.tsx and hosted-channel-operations.ts.
- Transcription provider category grounded in the current Groq → OpenRouter → local fallback implementation/Dockerfile.

## Validation

Site and web builds pass. Existing site suite: 12 tests. Existing login/account suites: 9 tests. Production-readiness suite: 11 tests. Total 32 tests passed. Static checks confirm all five page versions, support address, removal of personal email, and internal legal links. Legal Notice was rendered and inspected in the local site preview. `git diff --check` passes.

## Deployment / operational handoff

Deploying this version requires an immutable image containing the updated site, web, and server legal constant, and ZENOD_LEGAL_VERSION=2026-09-16 in that deployment. Do not update only the live environment to a version absent from its image. Retain public signup flags as-is until separately completing the outstanding production billing and Google/Drive evidence.

Before representing the privacy package as operationally verified, confirm the actual provider contracts and transfer mechanisms, provider training/data-retention settings (including Google Limited Use restrictions), backup expiry and deletion execution, and the stated routine log retention. These are operational checks, not facts established by editing a policy. The source does not visibly enforce a universal upstream no-training option; do not infer provider settings from that absence. Business processing requiring an Article 28 agreement is explicitly directed to support before data is submitted; no unverified standard DPA was invented.

The policies are working launch drafts grounded in current code and supplied company information. No legal professional review has been recorded. The package was subsequently published as recorded below; the remaining operational-verification limits still apply.


## Production publication receipt

- User explicitly requested pushing this legal update to production.
- Deployed source: `cd8f81a659cb01791b1421c87367a359f9b9605e`.
- Immutable image: `ghcr.io/zenod-ai/zenod@sha256:deb7379eeab5e534dba9b4dbebd689f7849cb438b3351e030fa338daf9fd6181`.
- Target: public `zenod-mt-fxpzoo` / application `2dkayH_eAur427leH64MT`. Private Phylax was not redeployed.
- Build and boot-smoke workflow passed: https://github.com/zenod-ai/zenod/actions/runs/35030219050
- Fresh public-volume backup and isolated restore passed; independent off-VPS copy checksum verified. Recovery files and original configuration remain protected outside the repository.
- Only `GIT_SHA` and `ZENOD_LEGAL_VERSION` changed in application environment. Legal version is now `2026-09-16`. Mounts, all other environment values, and both closed public-signup flags were compared and preserved.
- `/api/health` returned `status=ok` and the exact deployed SHA. Production readiness acknowledges the new legal version.
- All five public legal URLs returned successfully with version 2026-09-16. Cloudflare obfuscates email in raw HTML; decoding its attributes verified support@zenod.dev on every page. Browser inspection confirmed the rendered Privacy and Legal Notice pages, company identifiers, support mailto link, and working legal navigation.
- Publication does not open signup. Remaining billing/webhook/portal and Google/Drive acceptance checks are unchanged.
- Source integration PR: https://github.com/zenod-ai/zenod/pull/1312
