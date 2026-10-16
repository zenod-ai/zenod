# Skill self-update

**Upgrade = ask your agent "upgrade epic-spine" (or "update my epic-spine skill"), or run `python3 <skill-dir>/scripts/skill_update.py upgrade`.**

`<skill-dir>` is the installed skill directory (for example `~/.agents/skills/epic-spine`). The script is stdlib-only, Python 3.10+, and finds the directory from its own location.

## Central install (one copy, many harnesses)

Harnesses do not share a skills folder. To run one copy everywhere, keep the real copy in a hub (for example `~/.agents/skills/epic-spine`) and symlink each harness's entry to it; upgrade the hub itself, and the symlinks follow. Entries resolve to the hub, which is not a git checkout, so status and upgrade act on the hub. A plain per-harness copy works the same way.

## Status words

- `fresh` — the content (git tree hash of `skill/epic-spine/`) equals the source's; docs-only commits do not count. `fresh (cached, checked <date>)` is the last verdict, returned without a network call.
- `stale (installed <a> vs latest <b>)` — the source's skill tree differs; upgradeable. Within the window the cached verdict stays `stale (cached, ...)`.
- `unpinned` — no `<skill-dir>.SOURCE` pin file; `upgrade` adopts the copy.
- `unknown` — network or git failure. Exit 0, nothing modified, never raises.
- `linked` — the real (symlink-resolved) skill dir is inside a git work tree (source checkout or vendored copy in a repo), or a `.SOURCE` pin marks a vendored copy. Report only; never upgraded here.

## Session self-sync

The SessionStart hook already updates the skill, the machine profile and the current repo, so an agent rarely upgrades by hand: `references/session-sync.md`.

## Automatic policy

The hook handles the routine path; this section applies to a manual check.

The delivery manager runs `skill_update.py status` at bind. It is cheap: at most one remote check per window (default 1 day, tunable with `--window-days`; `--force` ignores it); within the window the answer is the pin's last verdict (`latest:` vs `tree:`) with no network call. A check is a blobless clone (`--filter=blob:none --no-checkout`) reading `HEAD:skill/epic-spine`. Setting `Skill updates:` in the root spine or `AGENTS.md`:

- `auto` (default) — when status is `stale` and upgradeable, run `upgrade --yes` **between tasks** (never mid-task), then tell the user in ≤ 3 lines what changed.
- `manual` — report staleness and ask before upgrading.
- `off` — never check.

`linked`/`unknown` produce one short line, no action, no nagging (at most once per window).

## How upgrade works

0. Run the blobless tree check; if the remote tree equals the pin's `tree:`, skip the swap, refresh `commit`/`checked`/`latest`, print `Already current`, exit 0.
1. Shallow-clone (`git clone --depth 1 --branch <ref>`) the source into a temp dir. The default source is the canonical repository; redirects to other hosts are disabled (`http.followRedirects=false`) and nothing in the downloaded tree is executed.
2. Verify the clone's `skill/epic-spine/` tree byte-for-byte against its own `MANIFEST.sha256` (re-implemented in Python; identical to `tools/epicspine-manifest.sh`). A mismatch aborts.
3. Atomic swap: the current directory is renamed to `<skill-dir>.bak` (exactly one backup generation, any older one replaced), then the verified tree moves into place.
4. Write the pin with `commit`, `manifest` digest, `version` from `VERSION`, `installed`, `checked`, `tree` and `latest`. On any failure the backup is restored and the pin is left untouched.

## Repo-level record

`VERSION` is a human CalVer label (`YYYY.MM.DD`, `.N` suffix for a same-day bump); bump it whenever a skill change lands on `main`. Freshness itself is decided by the skill tree hash, not by the label. After a check or upgrade the manager records one line in the root spine:

```text
EpicSpine skill: <version> @ <short sha>, checked <YYYY-MM-DD>
```

## Vendored copies

A vendored copy (for example `zenod/skills/epic-spine/`) is a snapshot, not an install. It ships a `<copy>.SOURCE` and `<copy>.manifest.sha256`; re-sync it per `SYNC.md`. `upgrade` refuses such copies and points at `SYNC.md`.

## Trust model

- Only the canonical repository is the default source; `--source`/`--ref` exist for forks and tests.
- No silent cross-host redirects; no code from the downloaded tree is executed.
- The manifest check makes drift visible; the pin records `source`, `path`, `commit`, `manifest`, `version`, `installed`, `checked`, `tree` (installed), `latest` (tree seen at last check).
- `status` never modifies the tree and only writes `checked`/`latest` (and `commit`/`tree` bookkeeping) after a successful remote check; `unknown` never modifies anything.
