#!/usr/bin/env bash
# One-shot migration: move the 2026-07-02 implementation tickets from the life
# backlog (AlfaBlok/obsidian-brain) into this code repo (zenod-ai/zenod), close
# the misfiled originals with pointer comments, and leave only the three epics
# open in obsidian-brain. Requires: gh (authenticated with write access to both
# repos). Safe to re-run: skips a move if a destination issue with the same
# title already exists.
#
# Usage: bash scripts/migrate-backlog-2026-07-02.sh
set -euo pipefail

SRC="AlfaBlok/obsidian-brain"
DST="zenod-ai/zenod"

# src_issue|title
TICKETS=(
  "220|S0-T1 — Deterministic backlog tools (backlog_create/edit/close/comment/list, repo hard-coded, read-back verified)"
  "221|S0-T2 — Archus persona rewrite: planner-coach only"
  "222|S0-T3 — Redirect contract + machine-readable capability cards, router-enforced"
  "224|S0-T5 — Route rule: per-repo issue writes only via Epaminon"
  "225|S0-T6 — Failure honesty enforced in tool layer (reply from verified result object only)"
  "226|S0-T7 — T0 reliability test suite in CI + daily canary with Phylax alert"
  "210|H1-T1 — jot tool: append-only Log write, provenance, zero LLM, instantly searchable"
  "211|H1-T2 — jot commit strategy: debounced batch, durable SQLite queue"
  "213|H1-T3 — capture policy rollout in all agent personas"
  "214|H1-T4 — outbound auto-jot on post_tweet/post_reddit/send_email"
  "215|H1-T5 — router hydration: top-k lexical memory injection"
  "218|H2-T1 — batch distiller: jots → meaning pages, one LLM pass, dedup, citations"
  "216|H2-T2 — distillation triggers: volume / distill-on-read / idle sweep"
  "217|H2-T3 — anti-slop guards: lint, immutable jot lines, provenance"
  "212|R1-T2 (amended) — execution results file via jot channel on terminal event"
)

echo "== Preflight: verifying gh auth and repo access =="
gh auth status >/dev/null
gh repo view "$SRC" --json name -q .name >/dev/null
gh repo view "$DST" --json name -q .name >/dev/null
echo "ok"

created=()
for entry in "${TICKETS[@]}"; do
  src="${entry%%|*}"
  title="${entry#*|}"

  # Idempotency: skip if an issue with this exact title already exists in DST.
  existing=$(gh issue list -R "$DST" --search "in:title \"${title%% —*}\"" --json number,title \
    -q ".[] | select(.title == \"$title\") | .number" | head -1 || true)
  if [ -n "$existing" ]; then
    echo "SKIP  $title  (already exists as $DST#$existing)"
    created+=("$src|$existing")
    continue
  fi

  body=$(gh issue view "$src" -R "$SRC" --json body -q .body)
  parent=$(gh issue view "$src" -R "$SRC" --json body -q .body | grep -oE '#(207|208|219)' | head -1 || true)
  full_body="$body

---
Migrated from https://github.com/$SRC/issues/$src (implementation lives in the code repo).
Parent epic: https://github.com/$SRC/issues/${parent#\#}"

  url=$(gh issue create -R "$DST" --title "$title" --body "$full_body")
  new_num="${url##*/}"
  echo "MOVED $SRC#$src -> $DST#$new_num  $title"
  created+=("$src|$new_num")

  # Read-back verification: never report success on an unverified write.
  gh issue view "$new_num" -R "$DST" --json number >/dev/null || { echo "FAILED read-back on $url"; exit 1; }

  gh issue close "$src" -R "$SRC" \
    -c "Moved to $url — implementation tickets live in the code repo; epics stay here."
done

echo "== W0: engine quota fallback (already implemented in commit 96dde57) =="
w0_title="W0 — Worker engine quota fallback: replay run on the other engine (codex↔claude) on quota-class errors"
w0_existing=$(gh issue list -R "$DST" --search "in:title W0" --json number,title -q ".[] | select(.title | startswith(\"W0\")) | .number" | head -1 || true)
if [ -z "$w0_existing" ]; then
  w0_url=$(gh issue create -R "$DST" --title "$w0_title" --body "On a quota-class worker failure (usage limit, 429, billing, insufficient_quota — incl. the exact codex error of 2026-07-02), replay the run once on the other engine when its CLI is installed. No env var decides recovery; the error class does. Logged as an engine.fallback event; surfaced in worker status.

STATUS: implemented in commit 96dde57 (scripts/fanout-codex.mjs) with 3 tests replaying the real 2026-07-02 error; suite 28/28. Close after the runner is redeployed and one live run exercises or passes through the fallback path.")
  echo "CREATED $w0_url"
else
  echo "SKIP  W0 (already exists as $DST#$w0_existing)"
fi

echo "== Closing meta/duplicate issues in $SRC =="
gh issue close 209 -R "$SRC" -c "Superseded: the T0 test-suite spec now lives with the implementation ticket S0-T7 in $DST." 2>/dev/null || echo "(#209 already closed)"
gh issue close 223 -R "$SRC" -c "Executed 2026-07-02 via this migration; epics-only bar now in effect." 2>/dev/null || echo "(#223 already closed)"

echo "== Linking children on the surviving epics =="
links=""
for pair in "${created[@]}"; do
  links="$links
- https://github.com/$DST/issues/${pair#*|}"
done
for epic in 207 208 219; do
  gh issue comment "$epic" -R "$SRC" --body "Implementation tickets migrated to $DST (2026-07-02):$links"
done

echo
echo "== DONE. Final state =="
echo "-- open in $SRC (should be epics only):"
gh issue list -R "$SRC" --state open --json number,title -q '.[] | "\(.number)\t\(.title)"'
echo "-- created/open in $DST:"
gh issue list -R "$DST" --state open --json number,title -q '.[] | "\(.number)\t\(.title)"' | head -25
