# Static marketing site for zenod.dev.
# Build context is the repo root: docker build -f apps/site/Dockerfile .

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
COPY apps/site ./apps/site
RUN npm run build -w site

# ---- runtime ----
FROM nginx:alpine
COPY --from=build /app/apps/site/dist /usr/share/nginx/html
COPY sites/ring/index.html /usr/share/nginx/html/ring/index.html
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY sites/epaminon/index.html /usr/share/nginx/html/epaminon/index.html
EXPOSE 80
