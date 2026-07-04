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
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY docs/tool-output-schemas.v4.json ./docs/tool-output-schemas.v4.json
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# drop dev dependencies for the runtime copy
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
# ffmpeg normalizes audio to 16 kHz mono WAV before cloud STT.
#
# NOTE: we intentionally do NOT compile/ship local whisper.cpp. Voice-note
# transcription runs on cloud STT (Groq → OpenRouter, see transcribe.ts); the local
# whisper-cli was only the FINAL fallback for when no cloud key is configured — never
# hit in practice (keys are set), yet it added a ~15-minute in-image C++ compile to
# EVERY deploy (and OOM/disk risk on the RAM-constrained shared box). Dropping it takes
# builds from ~15 min to ~2-3 min. The code still supports a local binary if one is ever
# put on PATH (ZENOD_WHISPER_BINARY) and degrades gracefully (ENOENT-handled) without it.
RUN apk add --no-cache git ripgrep ffmpeg libstdc++ libgomp
WORKDIR /app
# Baked in at build time (--build-arg GIT_SHA=$(git rev-parse HEAD)) so /api/health
# can report exactly which commit is running — deploy verification otherwise has
# no way to distinguish two builds (#532). Defaults to "unknown" for builds that
# don't pass it (e.g. a plain `docker build .` with no build-arg).
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    PORT=8080 \
    ZENOD_DATA_DIR=/data \
    ZENOD_WEB_DIST=/app/apps/web/dist \
    GIT_SHA=${GIT_SHA}

COPY --from=build /app/.gitsha ./.gitsha
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist

VOLUME /data
EXPOSE 8080

# The vault clone and SQLite state live on /data — one volume, whole state.
CMD ["node", "packages/server/dist/main.js"]
