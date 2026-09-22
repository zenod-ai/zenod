# Landing story integration — 2026-09-22

## Candidate and authority

- User approved all diagram-led sections below the existing hero, replacing legacy sections. No production deployment requested.
- Bound scope: ZLS / #1344. Worktree: `/Users/jordi/Documents/GitHub/zenod-landing-preview`.
- Branch: `codex/landing-two-section-preview`; base: `99f9f228285053d1354474b089691d86fe090fef`.
- Older issue/checklist text describes superseded full-slide integration. Current user-approved visual contract supersedes that presentation method, not the deployment gate.
- Local app: http://127.0.0.1:4319/ (frontend only).

Implementation commit: `2dba68787c5e74a29cd68b9fd462af42764b1877`. Local only; not merged to main or deployed.

## Result

- Existing hero JSX, original CSS and hero image match the base exactly, protected by SHA-256 regression tests.
- Ten storyboard-derived diagram assets under real HTML headings, leads and captions. No full slide, repeated raster navigation, or baked-in section headline.
- Legacy narrative/FAQ/final sections removed from homepage markup; footer/legal links retained. Navbar FAQ replaced by Run it your way.
- Existing pricing component embedded under the options diagram without the old chapter header. Standalone /pricing and all customer/signup logic retained.
- Story order: ownership, capture, cultivate, originals, recall, MCP agents, custodians, Alexandria, options, invitation (boards 01–07, 09, 08, 10).
- 20 WebP variants total under 1.6 MB; 10 large variants about 1.04 MB. Fixed dimensions, responsive sources, lazy loading. Native captions and alt text explain diagrams; full-size links allow close inspection.
- Built-in image generation; [final prompts and provenance](image-prompts.md). Internal diagram labels remain rasterized.

## Verification

- `npm run build -w site`: PASS.
- `npm run test -w site`: 17/17 PASS, including hero-preservation and storyboard tests.
- `git diff --check`: PASS.
- Real in-app browser: all ten desktop sections loaded; no horizontal document overflow. [Desktop checks](desktop-checks.json).
- All ten mobile chapters at observed 361px CSS viewport: loaded, no document overflow or overflowing copy/images. [Mobile checks](mobile-checks.json).
- Pricing CTA reaches /pricing; €9/month + VAT remains; Hosted button disabled when readiness is unavailable locally.
- Per-section desktop screenshots, key mobile screenshots and pricing evidence in this folder.

## Boundaries

Local candidate, not a deployed release. No sign-in, payment, production data or live backend mutations. Illustrations are conceptual, not integration proof or product screenshots. Public signup remains gated. Human visual review precedes any exact-SHA production deployment.

## Resume

Run `npm run dev -w site -- --host 127.0.0.1 --port 4319 --strictPort --base /` in the worktree. Review original hero, diagram chapters, full-size illustrations and Choose a plan navigation.
