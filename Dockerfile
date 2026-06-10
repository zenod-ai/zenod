# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# drop dev dependencies for the runtime copy
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
RUN apk add --no-cache git ripgrep
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ZENOD_DATA_DIR=/data \
    ZENOD_WEB_DIST=/app/web

COPY --from=build /app/node_modules ./node_modules
# replace the workspace symlinks with the real built package
RUN rm -rf ./node_modules/zenod ./node_modules/@zenod
COPY --from=build /app/packages/core/package.json ./node_modules/zenod/package.json
COPY --from=build /app/packages/core/dist ./node_modules/zenod/dist
COPY --from=build /app/packages/server/dist ./server
COPY --from=build /app/apps/web/dist ./web

VOLUME /data
EXPOSE 8080

# The vault clone and SQLite state live on /data — one volume, whole state.
CMD ["node", "server/main.js"]
