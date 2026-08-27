# Dedicated Phylax artifact. It reuses the proven channel/customer code but has
# one fixed entrypoint and cannot boot Zenod, PM, Ring, or another suite unit.

FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache git
COPY .git ./.git
RUN git rev-parse HEAD > /app/.gitsha 2>/dev/null || echo "unknown" > /app/.gitsha
RUN rm -rf ./.git

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-chassis/package.json packages/mcp-chassis/
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
COPY apps/phylax-site/package.json apps/phylax-site/
# npm's workspace lock includes the other application manifests. They are
# dependency metadata only; their sources and runtime assets are not copied.
COPY apps/site/package.json apps/site/
COPY apps/calli-web/package.json apps/calli-web/
COPY apps/calli-site/package.json apps/calli-site/
COPY apps/ring-site/package.json apps/ring-site/
COPY apps/herald-site/package.json apps/herald-site/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY docs/tool-output-schemas.v4.json ./docs/tool-output-schemas.v4.json
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/phylax-site ./apps/phylax-site
RUN npm run build -w zenod \
  && npm run build -w @zenod/mcp-chassis \
  && npm run build -w @zenod/server \
  && npm run build -w web \
  && npm run build -w phylax-site
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache git ripgrep ffmpeg libstdc++ libgomp
COPY vendor/whisper/whisper-cli-musl-amd64 /usr/local/bin/whisper-cli
RUN chmod +x /usr/local/bin/whisper-cli && whisper-cli --help >/dev/null 2>&1 \
  && echo "whisper-cli present" || (echo "whisper-cli FAILED to load" && exit 1)

WORKDIR /app
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    PORT=8080 \
    ZENOD_UNIT=phylax \
    AGENT=phylax \
    ZENOD_DATA_DIR=/data \
    ZENOD_WEB_DIST=/app/apps/web/dist \
    PHYLAX_SITE_DIST=/app/apps/phylax-site/dist \
    GIT_SHA=${GIT_SHA}

LABEL org.opencontainers.image.title="Phylax" \
      dev.zenod.runtime="phylax-only"

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
COPY --from=build /app/apps/phylax-site/dist ./apps/phylax-site/dist

VOLUME /data
EXPOSE 8080
CMD ["node", "packages/server/dist/phylaxMain.js"]
