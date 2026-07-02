# Vendored Reddit MCP server — jordanburke/reddit-mcp-server, pinned by commit.
#
# Serves FastMCP over Streamable HTTP (TRANSPORT_TYPE=httpStream) at $HOST:$PORT/mcp.
# Callistheness (the outbound agent) connects to this directly over the private
# docker network; no SSE bridge needed — same shape as services/x-mcp.
#
# Unlike x-mcp there is NO headless-oauth patch: this server authenticates
# non-interactively from env (REDDIT_CLIENT_ID/SECRET for the app, plus
# REDDIT_USERNAME/PASSWORD for the write tools like create_post), so it boots
# straight into HTTP mode with no browser consent.
FROM node:22-alpine

# Pin to a specific upstream commit (v1.5.1). Bump deliberately; never float to a
# branch. Kept in sync with docker-compose.reddit-mcp.yml.
ARG REDDIT_MCP_REF=53cca07c80d3d9eacd44fa1ff860b9f9427ffcfa

ENV NODE_ENV=production \
    SKIP_DTS=true \
    TRANSPORT_TYPE=httpStream \
    HOST=0.0.0.0 \
    PORT=3000

RUN corepack enable && corepack prepare pnpm@11.5.2 --activate \
 && apk add --no-cache git ca-certificates

WORKDIR /opt/reddit-mcp
RUN git clone https://github.com/jordanburke/reddit-mcp-server.git . \
 && git checkout "${REDDIT_MCP_REF}"

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000

# Creds come from the container environment (see .env.example). HOST=0.0.0.0 (above)
# so the endpoint is reachable from the outbound container on the shared network.
CMD ["node", "dist/index.js"]
