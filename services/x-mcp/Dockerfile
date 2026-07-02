# Vendored X (Twitter) MCP server — xdevplatform/xmcp, pinned by commit.
#
# Serves FastMCP over Streamable HTTP (transport="http") at $MCP_HOST:$MCP_PORT/mcp.
# Codex 0.137+ and Claude CLI connect to this directly; no SSE bridge needed.
#
# Headless patch: upstream ALWAYS runs an interactive OAuth1 browser-consent flow
# on startup (create_mcp -> build_oauth1_client -> run_oauth1_flow). headless-oauth1.patch
# makes it sign as your user with the OAuth1 access token/secret from env
# (X_OAUTH_ACCESS_TOKEN / X_OAUTH_ACCESS_TOKEN_SECRET) when both are set, so the
# container boots without a browser. Without those env vars it still falls back to
# the interactive flow (which fails in a container — by design).
#
# Relax patch: X's live OpenAPI spec marks response fields as required that the API
# does not actually return (e.g. MediaUploadResponse requires `meta`), so FastMCP's
# output validation rejects otherwise-successful calls. relax-response-required.patch
# strips `required` from response schemas ONLY (inline responses + `*Response`
# components); request/input schemas are untouched. Applies AFTER the headless patch.
FROM python:3.12-slim

# Pin to a specific upstream commit. Bump deliberately; never float to a branch.
ARG XMCP_REF=63d34362d88ed9f94d54ccd5ecd5bb4d12e11759

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/xmcp
RUN git clone https://github.com/xdevplatform/xmcp.git . \
 && git checkout "${XMCP_REF}"

COPY headless-oauth1.patch /tmp/headless-oauth1.patch
RUN git apply --verbose /tmp/headless-oauth1.patch

COPY relax-response-required.patch /tmp/relax-response-required.patch
RUN git apply --verbose /tmp/relax-response-required.patch

RUN pip install -r requirements.txt

EXPOSE 8000

# Creds come from the container environment (see .env.example). No .env file is
# baked in, so the server's load_env() is a no-op and os.getenv() reads the
# Docker-provided values. MCP_HOST defaults to 0.0.0.0 (above) so the endpoint is
# reachable from other containers on the shared network.
CMD ["python", "server.py"]
