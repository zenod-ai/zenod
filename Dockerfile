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
COPY apps/site/package.json apps/site/
COPY apps/calli-web/package.json apps/calli-web/
COPY apps/calli-site/package.json apps/calli-site/
COPY apps/ring-site/package.json apps/ring-site/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY docs/tool-output-schemas.v4.json ./docs/tool-output-schemas.v4.json
COPY packages ./packages
COPY apps ./apps
RUN npm run build
RUN npm run build -w calli-site && npm run build -w calli-web
RUN npm run build -w ring-site

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
RUN apk add --no-cache git ripgrep ffmpeg libstdc++ libgomp
COPY vendor/whisper/whisper-cli-musl-amd64 /usr/local/bin/whisper-cli
RUN chmod +x /usr/local/bin/whisper-cli && whisper-cli --help >/dev/null 2>&1 \
  && echo "whisper-cli present" || (echo "whisper-cli FAILED to load" && exit 1)
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
    ZENOD_SITE_DIST=/app/apps/site/dist \
    GIT_SHA=${GIT_SHA}

COPY --from=build /app/.gitsha ./.gitsha
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
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

VOLUME /data
EXPOSE 8080

# The vault clone and SQLite state live on /data — one volume, whole state.
CMD ["node", "packages/server/dist/main.js"]
