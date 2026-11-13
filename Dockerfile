# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# #532/#548 FP4 — capture the real commit SHA at build time so /api/health can report
# exactly which commit is running. Dokploy source-builds have no reliable way to pass a
# GIT_SHA build-arg (the compose default resolves to "unknown"), so we derive it from the
# checked-out .git (now included in the build context) and bake it into a file the runtime
# reads. A plain `docker build` with no .git falls back to "unknown".
RUN apk add --no-cache git
COPY .git ./.git
RUN git rev-parse HEAD > /app/.gitsha 2>/dev/null || echo "unknown" > /app/.gitsha
RUN rm -rf ./.git

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-chassis/package.json packages/mcp-chassis/
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
COPY apps/phylax-web/package.json apps/phylax-web/
COPY apps/site/package.json apps/site/
COPY apps/calli-web/package.json apps/calli-web/
COPY apps/calli-site/package.json apps/calli-site/
COPY apps/ring-site/package.json apps/ring-site/
COPY apps/herald-site/package.json apps/herald-site/
COPY apps/phylax-site/package.json apps/phylax-site/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY docs/tool-output-schemas.v4.json ./docs/tool-output-schemas.v4.json
COPY packages ./packages
COPY apps ./apps
RUN npm run build
RUN npm run build -w calli-site && npm run build -w calli-web
RUN npm run build -w ring-site
RUN npm run build -w herald-site
RUN npm run build -w phylax-site

# drop dev dependencies for the runtime copy
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
# ffmpeg normalizes audio to 16 kHz mono WAV; libstdc++/libgomp are whisper-cli's
# runtime deps.
#
# WHISPER FALLBACK — PREBUILT, NOT COMPILED. Voice-note transcription runs on cloud
# STT first (Groq → OpenRouter, see transcribe.ts), but that cascade must have a
# safety net: when the cloud provider errors (rate limit, network, quota), the code
# falls through to local whisper.cpp. #575 removed whisper entirely, so any cloud
# hiccup surfaced "whisper-cli is not installed" to the user (Jordi's primary input).
# We restore the fallback WITHOUT the ~15-minute per-deploy C++ compile that #575
# rightly killed: a prebuilt musl/amd64 whisper-cli (built once, whisper.cpp ref in
# vendor/whisper/whisper-ref.txt, runtime-verified against libstdc++/libgomp) is
# COPY'd straight in. No build stage, no compile, no network — just the binary, per
# Jordi's directive. Overridable via ZENOD_WHISPER_BINARY; still ENOENT-graceful.
RUN apk add --no-cache git ripgrep ffmpeg libstdc++ libgomp tini
# Zombie git fix (infra-vps EPIC-2-A27): every git commit/fetch/pull runs
# `git maintenance run --auto --detach`, which forks and orphans a git child even
# when there is nothing to do; node as PID 1 never reaps it, so zombies piled up
# (~53/h on zenod-mt). Run auto-maintenance in the foreground (simple-git awaits
# it) and put tini in front as PID 1 to reap any other orphan.
RUN git config --system maintenance.autoDetach false \
  && git config --system gc.autoDetach false
COPY vendor/whisper/whisper-cli-musl-amd64 /usr/local/bin/whisper-cli
RUN chmod +x /usr/local/bin/whisper-cli && whisper-cli --help >/dev/null 2>&1 \
  && echo "whisper-cli present" || (echo "whisper-cli FAILED to load" && exit 1)
WORKDIR /app
# Baked in at build time (--build-arg GIT_SHA=$(git rev-parse HEAD)) so /api/health
# can report exactly which commit is running — deploy verification otherwise has
# no way to distinguish two builds (#532). Defaults to "unknown" for builds that
# don't pass it (e.g. a plain `docker build .` with no build-arg).
ARG GIT_SHA=unknown
# EPIC-24 M15: Node's default heap stops near 330 MB whatever the container allows, so zenod-mt's
# 640 MiB never reached JavaScript. 448 MB lets the heap use it and leaves ~190 MiB for code, buffers
# and SQLite. A Dokploy env NODE_OPTIONS overrides this. Rollback: remove this line (docs/DEPLOYMENTS.md).
ENV NODE_OPTIONS=--max-old-space-size=448
ENV NODE_ENV=production \
    PORT=8080 \
    ZENOD_DATA_DIR=/data \
    ZENOD_WEB_DIST=/app/apps/web/dist \
    ZENOD_SITE_DIST=/app/apps/site/dist \
    GIT_SHA=${GIT_SHA}

COPY --from=build /app/.gitsha ./.gitsha
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build /app/packages/mcp-chassis/package.json ./packages/mcp-chassis/package.json
COPY --from=build /app/packages/mcp-chassis/dist ./packages/mcp-chassis/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/site/dist ./apps/site/dist
COPY --from=build /app/apps/calli-web/dist ./apps/calli-web/dist
COPY --from=build /app/apps/calli-site/dist ./apps/calli-site/dist
COPY --from=build /app/apps/ring-site/dist ./apps/ring-site/dist
COPY --from=build /app/apps/herald-site/dist ./apps/herald-site/dist
COPY --from=build /app/apps/phylax-site/dist ./apps/phylax-site/dist
COPY units/zenod/skill/zenod ./units/zenod/skill/zenod
COPY scripts/verify-zenod-data.mjs ./scripts/verify-zenod-data.mjs

VOLUME /data
EXPOSE 8080
# EPIC-24 M6: releases roll start-first, so Swarm must know when the new task can take traffic.
# zenod-mt also sets the same check in Dokploy (docs/DEPLOYMENTS.md); this one keeps the roll
# gated on health if that setting is ever cleared. busybox wget, no extra package.
HEALTHCHECK --interval=5s --timeout=5s --start-period=60s --retries=6 \
  CMD wget -q -T 5 -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

# The vault clone and SQLite state live on /data — one volume, whole state.
# tini is PID 1: reaps orphans and forwards SIGTERM to node (E15-R10 shutdown grace).
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/main.js"]
