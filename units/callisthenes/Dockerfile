# units/callisthenes/Dockerfile — the Callisthenes atomic unit (outbound-to-X).
#
# Mirrors services/x-mcp/Dockerfile: clone upstream xdevplatform/xmcp pinned by
# commit, apply the headless + relax patches, install deps. THE DIFFERENCE: the
# CMD runs OUR wrapper entrypoint (callisthenes_server.py) instead of upstream
# server.py, so the throttle + drafts-never-send (C-22) middleware are enforced
# IN THE UNIT (see callisthenes_server.py / throttle.py / draft_guard.py). Per
# EPIC-2.4 §125 these controls used to be "delegated to the agent layer, NOT in
# x-mcp"; C-1 lands them in the container itself.
#
# The wrapper imports upstream's `server` module and calls its `create_mcp()`
# factory, so no patch against upstream's main() is needed — the two existing
# patches (which only touch build_oauth1_client + the spec relaxer) still apply
# cleanly. The optional auth/ package (C-2, per-tenant PIN chat-auth) is COPY'd
# if present and loaded at boot via the shared auth.register(mcp) contract; the
# unit boots single-owner headless when it is absent.
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

# Existing xmcp patches (order preserved from services/x-mcp): headless first,
# then response-required relax.
COPY headless-oauth1.patch /tmp/headless-oauth1.patch
RUN git apply --verbose /tmp/headless-oauth1.patch

COPY relax-response-required.patch /tmp/relax-response-required.patch
RUN git apply --verbose /tmp/relax-response-required.patch

RUN pip install -r requirements.txt

# The unit's own modules land next to upstream server.py so `import server`
# resolves. throttle.py + draft_guard.py are enforced in-unit; the wrapper is CMD.
# Copying the whole unit context also picks up the optional auth/ package (C-2
# owns units/callisthenes/auth/) WITHOUT a brittle conditional COPY: if auth/ is
# absent the build still succeeds and the wrapper's try/except boots single-owner
# headless; when C-2 lands auth/__init__.py:register(mcp) it is present on the
# PYTHONPATH and loaded via the shared auth.register(mcp) contract at boot.
# .dockerignore excludes tests + docs so they don't bloat the image.
COPY . ./

EXPOSE 8000

# Creds come from the container environment (see .env.example). CMD runs the unit
# wrapper, which installs middleware + the auth hook, then serves Streamable HTTP.
CMD ["python", "callisthenes_server.py"]
