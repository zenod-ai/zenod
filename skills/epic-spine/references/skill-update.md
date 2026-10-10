# Skill self-update

**Upgrade = ask your agent "upgrade epic-spine" (or "update my epic-spine skill"), or run `python3 <skill-dir>/scripts/skill_update.py upgrade`.**

`<skill-dir>` is the installed skill directory (for example `~/.agents/skills/epic-spine`). The script is stdlib-only, Python 3.10+, and finds the directory from its own location.

## Central install (one copy, many harnesses)

Harnesses do not share a skills folder. To run one copy everywhere, keep the real copy in a hub (for example `~/.agents/skills/epic-spine`) and symlink each harness's entry to it; upgrade the hub itself, and the symlinks follow. A plain per-harness copy works the same way.

## Status words

- `fresh` — the installed commit equals the latest source commit. `fresh (cached, checked <date>)` means the answer came from the pin without a network call.
- `stale (installed <a> vs latest <b>)` — a newer source commit exists and the copy is upgradeable.
- `unpinned` — no `<skill-dir>.SOURCE` pin file; `upgrade` adopts the copy.
- `unknown` — network or git failure. Exit 0, nothing modified, never raises.
- `linked` — the skill dir or its parent is a symlink, or a `.SOURCE` pin marks a vendored copy. Report only; never upgraded here.

## Automatic policy

The delivery manager runs `skill_update.py status` at bind. It is cheap: at most one remote check per window (default 7 days, tunable with `--window-days`); within the window the answer comes from the pin's `checked:` line with no network call. Setting `Skill updates:` in the root spine or `AGENTS.md`:

- `auto` (default) — when status is `stale` and upgradeable, run `upgrade --yes` **between tasks** (never mid-task), then tell the user in ≤ 3 lines what changed.
- `manual` — report staleness and ask before upgrading.
- `off` — never check.

`linked`/`unknown` produce one short line, no action, no nagging (at most once per window).

## How upgrade works

1. Shallow-clone (`git clone --depth 1 --branch <ref>`) the source into a temp dir. The default source is the canonical repository; redirects to other hosts are disabled (`http.followRedirects=false`) and nothing in the downloaded tree is executed.
2. Verify the clone's `skill/epic-spine/` tree byte-for-byte against its own `MANIFEST.sha256` (re-implemented in Python; identical to `tools/epicspine-manifest.sh`). A mismatch aborts.
3. Atomic swap: the current directory is renamed to `<skill-dir>.bak` (exactly one backup generation, any older one replaced), then the verified tree moves into place.
4. Write the pin with `commit`, `manifest` digest, `version` from `VERSION`, `installed` and `checked`. On any failure the backup is restored and the pin is left untouched.

## Repo-level record

`VERSION` is a human CalVer label (`YYYY.MM.DD`); bump it whenever a skill change lands on `main`. Freshness itself is decided by commit and manifest, not by the label. After a check or upgrade the manager records one line in the root spine:

```text
EpicSpine skill: <version> @ <short sha>, checked <YYYY-MM-DD>
```

## Vendored copies

A vendored copy (for example `zenod/skills/epic-spine/`) is a snapshot, not an install. It ships a `<copy>.SOURCE` and `<copy>.manifest.sha256`; re-sync it per `SYNC.md`. `upgrade` refuses such copies and points at `SYNC.md`.

## Trust model

- Only the canonical repository is the default source; `--source`/`--ref` exist for forks and tests.
- No silent cross-host redirects; no code from the downloaded tree is executed.
- The manifest check makes drift visible; the pin records `source`, `path`, `commit`, `manifest`, `version`, `installed`, `checked`.
- `status` never modifies the tree and only writes `checked:` after a successful remote check; `unknown` never modifies anything.
