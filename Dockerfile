# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG NODE_VERSION=24.19.0
ARG NODE_IMAGE_DIGEST=sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS dependencies
ARG PNPM_VERSION=11.22.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:${NODE_VERSION}-alpine@${NODE_IMAGE_DIGEST} AS ui-builder
ARG PNPM_VERSION=11.22.0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY vite.config.ts ./
COPY web ./web
COPY standalone/ui/app.css ./standalone/ui/app.css
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
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "bin/qwbe-invoicing.ts", "serve"]
