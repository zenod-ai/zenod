# Conservative Terms revision — 2026-09-16.1

Requested by Jordi after publishing the initial legal package: minimize discretionary refund, warranty, and liability exposure.

Changes: no voluntary refund guarantee; payments non-refundable except mandatory law; business-only as-is warranty exclusions, direct/indirect liability exclusions to the lawful extent, fallback aggregate cap of three months' affected-service fees; bounded business indemnity; independent backups, AI-output review, third-party/force-majeure provisions; business Barcelona forum. Consumers and non-excludable liability are expressly outside the business exclusions and cap.

The previous Terms are preserved at `/legal/archive/terms-2026-09-16.html`. Existing accepted subscriptions retain their terms until the applicable notice/acceptance process is completed. No customer notice was sent and no accrued entitlement was removed. New version: 2026-09-16.1. Privacy and other legal-page versions remain 2026-09-16.

Primary legal references reviewed:
- Spanish consumer law, especially unfair terms, basic rights, withdrawal and digital-service conformity: https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555
- Civil Code Article 1102 (intentional misconduct cannot be waived): https://www.boe.es/eli/es/rd/1889/07/24/(1)/con

Drafting and product-implementation work, not a guarantee of enforceability. Spanish counsel should review the final B2B exclusion/cap and consumer disclosures before relying on them in a dispute. No representation of legal-professional review is made.

Validation: site build and 11 production-readiness tests pass; diff whitespace check passes. Current public site source has no remaining voluntary refund offer outside the deliberately archived previous Terms.

## Production receipt

Published to the public Zenod service; `/api/health` verifies source `4b0e08241e145711139ff98602f76ef1b683572d` and immutable image `ghcr.io/zenod-ai/zenod@sha256:780fd7f7025f64ee971213b74454d87d845cf7089d5fcd6dfe7e1ae94c08f647`. Build/boot workflow succeeded: https://github.com/zenod-ai/zenod/actions/runs/35031626174.

Only GIT_SHA and ZENOD_LEGAL_VERSION changed in the runtime environment; image mounts, other configuration, private service, and closed signup flags were preserved. The immediately preceding verified backup/recovery point remains available outside the repository; original deployment configuration was captured before this switch.

Live HTTP checks passed for the revised version, non-refundable policy, business direct/indirect exclusion, three-month fallback cap, consumer protections, and preserved previous Terms archive. Browser inspection confirmed the new version and refund policy render at the production URL. This receipt proves publication, not legal enforceability or general launch readiness.
