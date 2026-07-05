# The council guy — image note (ticket W-B)
#
# RD-4 is STAGED (monorepo now; per-unit folders + independent builds, split at the trigger).
# Per the roster pattern (docker-compose.archus.yml et al.), the suite runs ONE root image
# selected by the AGENT env var — Archus, Epaminon, Callistheness and the fused Console are all
# `AGENT=<name>` on the SAME root ../../Dockerfile. The council guy follows that pattern: it needs
# NO separate Dockerfile of its own yet.
#
# ROOT-IMAGE REUSE (this iteration):
#   build context = repo root; dockerfile = ../../Dockerfile
#   entrypoint    = node packages/server/dist/main.js   (unchanged)
#   selector      = AGENT=council                        (see BLOCKER below)
# The docker-compose.council.yml stub in this folder wires exactly that.
#
# BLOCKER (honest): there is NO `council` AgentDefinition in packages/server/src/agent.ts yet —
# only `console` (the fused brain). Today `AGENT=council` would fall through resolveAgent() to the
# default (Zenod). Booting a real council guy requires adding a COUNCIL_AGENT definition
# (vaultless, peer-tools-only: zenod/archus/epaminon, turn-preamble) — the first code step when
# the RD-4 split trigger fires. See EXTRACTION-MAP.md. Until then the live unit is `AGENT=console`.
#
# A leaner council-only image (no whisper/transcription, no channel gateways) is a future
# optimization for after the physical split — the council guy holds no adapter code, so it does
# not need the transcription toolchain the root image bakes for the ring.
#
# There is intentionally no FROM/COPY/CMD here: adding a second buildable Dockerfile now would
# fork the build while the code is still fused. Reuse ../../Dockerfile.
