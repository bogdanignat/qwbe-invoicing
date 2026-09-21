# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG NODE_VERSION=24.19.0
ARG NODE_IMAGE_DIGEST=sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS builder
ARG PNPM_VERSION=11.22.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm --filter @qwbe/invoicing-frontend install --frozen-lockfile
COPY frontend ./frontend
RUN pnpm --filter @qwbe/invoicing-frontend build

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
# No public directory exists in phase one; all styles/assets are in .next/static.
COPY frontend/scripts/validate-runtime.mjs ./frontend/scripts/validate-runtime.mjs
COPY frontend/src/lib/server/config.ts ./frontend/src/lib/server/config.ts
RUN mkdir -p /app/frontend/.next/cache && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--import", "./frontend/scripts/validate-runtime.mjs", "frontend/server.js"]
