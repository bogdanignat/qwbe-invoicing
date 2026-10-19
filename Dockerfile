# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG NODE_VERSION=24.19.0
ARG NODE_IMAGE_DIGEST=sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

# pnpm and the workspace manifests, shared by the two install stages below.
FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS base
ARG PNPM_VERSION=11.22.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json

FROM base AS dependencies
RUN pnpm --filter qwbe-invoicing install --frozen-lockfile --prod

# The browser bundle. Its build dependencies (Vite, Tailwind, TypeScript) live only
# in this stage: the runtime below receives `frontend/dist` and nothing else from it.
# `frontend/` is self-contained: vite.config.ts, tsconfig.json and scripts/ import
# nothing from outside it, so the root manifests are the only other input.
FROM base AS ui-builder
RUN pnpm --filter @qwbe/invoicing-frontend install --frozen-lockfile
COPY frontend ./frontend
RUN pnpm build:frontend

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    QWBE_UI_DIR=/app/frontend/dist
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY cubes ./cubes
COPY kernel ./kernel
COPY --from=ui-builder /app/frontend/dist ./frontend/dist
# `pg_dump`/`pg_restore` for the ops commands, installed in the runtime stage and
# BEFORE `USER node`, because apk needs root. Client 16 exactly, matching the
# server: a newer client writes an archive the older server cannot read back,
# and the version is asserted at build time rather than trusted.
#
# The revision is pinned on purpose, against a live Alpine index: when the branch
# rotates to a newer -rN this build stops working until the pin is bumped. Read
# the current revision from the pinned base image itself:
#   docker run --rm node:24.19.0-alpine@sha256:d32cdf61... \
#     sh -c "apk add --no-cache --simulate postgresql16-client | tail -1"
ARG PG_CLIENT_VERSION=16.15-r0
RUN apk add --no-cache "postgresql16-client=${PG_CLIENT_VERSION}" \
 && pg_dump --version | grep -q " 16\."
# `/var/backups/staging` exists in the image and is owned by `node` because a named
# volume mounted on a path the image does not have is created root-owned, and the
# process runs unprivileged: `backup` would fail on `mkdtemp` with EACCES. Compose
# points TMPDIR here so the staging tree lands on disk instead of the bounded tmpfs.
RUN mkdir -p /data /var/backups/staging \
 && chown -R node:node /app /data /var/backups/staging
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "bin/qwbe-invoicing.ts", "serve"]
