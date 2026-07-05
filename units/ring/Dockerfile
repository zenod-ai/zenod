# Ring unit — Dockerfile note (SCAFFOLD, not yet a real build)
#
# STAGING (RD-4, not fired): the physical split has real cost, so we do NOT yet ship a
# separate ring image. Today the whole Console (fused ring + council guy) builds from the
# ROOT ./Dockerfile and runs `node packages/server/dist/main.js` with the engine attached
# in-process.
#
# TARGET (post-split): the Ring compose runs TWO images:
#
#   ring-core  — reuse the root Dockerfile with a ring entrypoint. ring-core needs the
#                server build (mailbox, router, media pipeline, keyring UI, web dist) but
#                NOT the vault/brain (engine.ts) code path. Concretely, once the council
#                guy (W-B) is extracted, ring-core boots with AGENT=ring and an entrypoint
#                that starts the adapters + router + web UI and does NOT construct a
#                BrainEngine — it holds only per-unit MCP tokens for the guys it may call.
#                Interim: AGENT=ring on the root image, guys reached over the seam.
#
#   phylax     — the channel gateway. Own image, own volume for Baileys/Telegram session
#                state. Builds from the root Dockerfile with AGENT=phylax and an entrypoint
#                that starts ONLY the Baileys + Telegram sockets + the pairing/QR web
#                screen + its MCP server (send_to_user, get_media). Zero engine, zero vault.
#                (This is the box that today's docker-compose.phylax.yml runs headless as
#                the attention gatekeeper; its NAME moves here, its attention LOGIC moves
#                into ring-core.)
#
# Until the split trigger fires, treat this file as documentation. The real build is
# ../../Dockerfile; the compose below selects behaviour by AGENT + entrypoint, not by a
# separate Dockerfile per box.
#
# See ../../Dockerfile for the actual multi-stage build and EXTRACTION-MAP.md for what
# each box needs compiled in.
