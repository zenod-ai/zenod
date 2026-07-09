# Epaminon unit - Dockerfile note (root-image reuse).
#
# Epaminon reuses the repository root image. Build from the repo root:
#
#   docker build -t zenod-epaminon .
#   docker run -e AGENT=epaminon -e ZENOD_DATA_DIR=/data -v epaminon-data:/data zenod-epaminon
#
# The unit-local compose builds with context ../.. and dockerfile Dockerfile, meaning
# ../../Dockerfile from the repo root. There is no Epaminon-specific build context yet.
#
# Keep this as a non-building placeholder until the physical split fires. Copying the
# root Dockerfile body here would fork a moving target while Epaminon still ships from
# the shared suite image.

FROM scratch
# intentionally non-building placeholder - see note above; build from ../../Dockerfile
