# Zenod Agent Runner Sidecar

The agent runner is a separate container for Codex fan-out work. Keep it separate from the Zenod app container: Zenod owns memory, MCP, chat, ingestion, and vault writes; the runner owns GitHub issue execution, worktrees, Codex subprocesses, draft PRs, and `.fanout` status.

## Build

```sh
docker build -f Dockerfile.agent-runner -t zenod-agent-runner .
```

The image uses Node 22 and installs `git`, `gh`, `ripgrep`, shell utilities, and the Codex CLI. The Codex version is pinned by the `CODEX_VERSION` build arg:

```sh
docker build -f Dockerfile.agent-runner --build-arg CODEX_VERSION=0.137.0 -t zenod-agent-runner .
```

## Run

Use durable volumes. `CODEX_HOME` and `GH_CONFIG_DIR` must persist so auth survives container restarts.

```sh
docker volume create zenod-agent-work
docker volume create zenod-agent-codex-home
docker volume create zenod-agent-gh

docker run -d --name zenod-agent-runner \
  -v zenod-agent-work:/runner/work \
  -v zenod-agent-codex-home:/runner/codex-home \
  -v zenod-agent-gh:/runner/gh \
  zenod-agent-runner
```

## Auth

Codex auth is runner-scoped. Do not rely on `/root/.codex` from the VPS host inside this container.

Authenticate Codex inside the runner:

```sh
docker exec -it zenod-agent-runner codex login --device-auth
docker exec zenod-agent-runner codex login status
```

Authenticate GitHub inside the runner:

```sh
docker exec -it zenod-agent-runner gh auth login
docker exec zenod-agent-runner gh auth status
```

For automation, seed `/runner/codex-home/auth.json` and `/runner/gh` from a trusted secret store or a one-time login, then let those volumes persist. Use one Codex auth volume per serialized runner stream; do not share one `auth.json` across multiple concurrently refreshing containers.

## Smoke Test

```sh
docker exec zenod-agent-runner node --version
docker exec zenod-agent-runner codex login status
docker exec zenod-agent-runner gh auth status

docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 17,18,19 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Drain Zenod agent-owned launch issues into isolated branches, draft PRs, or structured blocked reports." \
  --dry-run \
  --concurrency 3
```

Then inspect the run:

```sh
docker exec zenod-agent-runner zenod-fanout-codex status \
  --workdir /runner/work/zenod \
  --run <run-id>

docker exec zenod-agent-runner zenod-fanout-codex inspect \
  --workdir /runner/work/zenod \
  --run <run-id> \
  --issue 19
```

## Real Run Sequence

Start with a single no-push worker:

```sh
docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 18 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Prove one Codex subagent can work an issue in the runner sidecar and report observable status." \
  --no-push \
  --concurrency 1
```

After that works, run the launch fan-out with draft PRs and GitHub status comments:

```sh
docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 17,18,19 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Drain Zenod launch implementation issues #17, #18, and #19 into draft PRs or concrete blocked questions without merging to main." \
  --draft-pr \
  --github-status \
  --concurrency 3
```

No command in this flow merges to `main`.
