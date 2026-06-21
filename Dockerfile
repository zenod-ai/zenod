# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

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

# ---- whisper.cpp (local, in-image transcription) ----
# Same node:22-alpine base as the runtime so the musl/libstdc++ ABI matches.
FROM node:22-alpine AS whisper
RUN apk add --no-cache build-base cmake git
WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
WORKDIR /opt/whisper.cpp
# Static ggml/whisper libs linked into one whisper-cli binary; native SIMD
# (the image is built on the same host it runs on via Dokploy).
# -j2 (not nproc): the Dokploy build host is RAM-constrained; 4 parallel g++
# jobs on ggml can OOM-kill the build.
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build -j2 --target whisper-cli

# ---- runtime ----
FROM node:22-alpine
# ffmpeg normalizes audio to 16 kHz mono WAV; libgomp/libstdc++ are whisper-cli's
# runtime deps. The whisper model itself downloads once to the /data volume.
RUN apk add --no-cache git ripgrep ffmpeg libstdc++ libgomp
COPY --from=whisper /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ZENOD_DATA_DIR=/data \
    ZENOD_WEB_DIST=/app/apps/web/dist

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
