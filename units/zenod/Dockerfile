# units/zenod/Dockerfile — BLUEPRINT (root-image reuse).
#
# Zenod ships from the SAME root image as the rest of the suite; the agent is
# selected at runtime by the AGENT env var (default = zenod). See
# packages/server/src/main.ts:23 `resolveAgent(process.env.AGENT)` and
# packages/server/src/agent.ts:167 (defaults to ZENOD_AGENT). There is nothing
# Zenod-specific to compile — one image, `AGENT=zenod` picks the memory agent.
#
# RD-4 status: physical extraction (own build context under units/zenod/) is
# STAGED behind the split trigger, which has NOT fired. Until then Zenod's image
# IS the root image and the correct build is:
#
#   docker build -f ../../Dockerfile -t zenod ../..
#   docker run -e AGENT=zenod -e ZENOD_DATA_DIR=/data -v zenod-data:/data -p 8080:8080 zenod
#
# When the split trigger fires (SEAM-SPEC v1 passes the tester on >=2 units), this
# file becomes a real self-contained build over the git-filter-repo'd subtree:
# node:22-alpine build stage (npm ci + npm run build over packages/core +
# packages/server), runtime stage with git/ripgrep/ffmpeg (voice STT + vault git),
# CMD ["node","packages/server/dist/main.js"] with ENV AGENT=zenod. The entrypoint
# and CMD are already correct in the root Dockerfile — extraction is a context
# narrowing, not a rewrite.
#
# DO NOT copy the root Dockerfile body here yet: that duplicates a moving target
# while code still shifts (RD-4 (b) discipline). This stub is the seam of record.
FROM scratch
# intentionally non-building placeholder — see note above; build from ../../Dockerfile
