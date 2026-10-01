# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG NODE_VERSION=24.19.0
ARG NODE_IMAGE_DIGEST=sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS dependencies
ARG PNPM_VERSION=11.22.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm --filter qwbe-invoicing install --frozen-lockfile --prod

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS ui-builder
ARG PNPM_VERSION=11.22.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm --filter qwbe-invoicing install --frozen-lockfile
COPY vite.config.ts ./
COPY web ./web
COPY standalone/http/ui-routes.ts ./standalone/http/ui-routes.ts
RUN pnpm build:ui

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY cube ./cube
COPY standalone ./standalone
COPY --from=ui-builder /app/standalone/ui-dist ./standalone/ui-dist
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
