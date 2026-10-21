import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { URL } from "node:url"
import test from "node:test"

const path = (name) => new URL(`../${name}`, import.meta.url)
const source = (name) => readFileSync(path(name), "utf8")
/** A YAML file without its comment lines: what Compose acts on, not what it explains. */
const code = (name) => source(name).split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n")

/**
 * The services of a compose file, in order, by their two-space indentation under
 * `services:`. A name count cannot say WHICH service is opt-in or exposed: the
 * roster is compared whole.
 */
const services = (compose) => {
  const body = compose.split(/^services:$/mu)[1]?.split(/^[a-z]+:$/mu)[0] ?? ""
  return body.split("\n").flatMap((line) => {
    const match = /^ {2}([a-z][a-z0-9-]*):\s*$/u.exec(line)
    return match?.[1] === undefined ? [] : [match[1]]
  })
}

/** The block of one service, up to the next service or the next top-level key. */
const serviceBlock = (compose, name) => {
  const after = compose.split(new RegExp(`^ {2}${name}:$`, "mu"))[1] ?? ""
  return after.split(/^(?: {2}[a-z][a-z0-9-]*:$|[a-z]+:$)/mu)[0] ?? ""
}

/** The Dockerfile stage that starts at `AS <name>`, up to the next `FROM`. */
const stage = (docker, name) => docker.split(new RegExp(`^FROM .* AS ${name}$`, "mu"))[1]?.split(/^FROM /mu)[0] ?? ""

const shippedCompose = ["compose.yaml", "compose.prod.yaml", "compose.preview.yaml"]
const allCompose = [...shippedCompose, "compose.loopback.yaml", "compose.vite.yaml", "compose.verify.yaml", "compose.test.yaml"]

void test("one image: the kernel ships the Vite build from its ui-builder stage and nothing else of the frontend", () => {
  assert.equal(existsSync(path("frontend/Dockerfile")), false, "the -frontend image is gone")
  const docker = source("Dockerfile")
  // One bootstrap (pnpm, workspace manifests) shared by both install stages; the runtime starts clean.
  assert.match(stage(docker, "base"), /corepack prepare pnpm@\$\{PNPM_VERSION\} --activate/u)
  assert.deepEqual(docker.match(/^FROM base AS [a-z-]+$/gmu), ["FROM base AS dependencies", "FROM base AS ui-builder"])
  assert.match(docker, /^FROM node:\S+ AS runtime$/mu)
  const builder = stage(docker, "ui-builder")
  assert.match(builder, /pnpm --filter @qwbe\/invoicing-frontend install --frozen-lockfile\n/u, "build dependencies, not --prod")
  assert.match(builder, /RUN pnpm build:frontend/u)
  const runtime = stage(docker, "runtime")
  assert.match(runtime, /QWBE_UI_DIR=\/app\/frontend\/dist/u)
  assert.match(runtime, /COPY --from=ui-builder \/app\/frontend\/dist \.\/frontend\/dist/u)
  // From the frontend, only `dist` reaches the runtime; its node_modules are the kernel's --prod set.
  assert.deepEqual(runtime.match(/^COPY .*frontend.*$/gmu), ["COPY --from=ui-builder /app/frontend/dist ./frontend/dist"])
  assert.match(runtime, /COPY --from=dependencies \/app\/node_modules \.\/node_modules/u)
  assert.match(stage(docker, "dependencies"), /install --frozen-lockfile --prod/u)
  assert.doesNotMatch(runtime, /pnpm (?:install|build)|COPY \. \.|AUTH_TOKEN|\.next/u)
  assert.match(runtime, /USER node/u)
  assert.match(runtime, /http:\/\/127\.0\.0\.1:3000\/health\/ready/u)
  assert.match(runtime, /CMD \["node", "bin\/qwbe-invoicing\.ts", "serve"\]/u)
})

void test("no compose file runs a frontend service or a Next variable", () => {
  for (const name of allCompose) {
    const compose = code(name)
    assert.ok(!services(compose).includes("frontend"), `${name} still has a frontend service`)
    assert.doesNotMatch(compose, /FRONTEND_ORIGIN|FRONTEND_IMAGE_TAG|INVOICING_API_URL|frontend\/Dockerfile|\.next|-frontend:/u, name)
  }
})

void test("development: app owns the Warden route and derives PUBLIC_ORIGIN from APP_DOMAIN", () => {
  const compose = source("compose.yaml")
  assert.deepEqual(services(compose), ["db", "migrate", "app"])
  const app = serviceBlock(compose, "app")
  assert.match(app, /PUBLIC_ORIGIN: https:\/\/\$\{APP_DOMAIN:-invoice\.test\}/u)
  assert.match(app, /networks:\n {6}- default\n {6}- warden/u)
  assert.match(app, /traefik\.http\.routers\.qwbe-invoicing\.rule: Host\(`\$\{APP_DOMAIN:-invoice\.test\}`\)/u)
  assert.match(app, /loadbalancer\.server\.port: "3000"/u)
  assert.match(app, /QWBE_BEARER_API: \$\{QWBE_BEARER_API:-off\}/u)
  assert.doesNotMatch(app, /ports:/u)
})

void test("vite dev reaches the kernel on loopback only, with the dev server as its origin", () => {
  const overlay = source("compose.vite.yaml")
  assert.deepEqual(services(overlay), ["app"])
  assert.match(serviceBlock(overlay, "app"), /PUBLIC_ORIGIN: http:\/\/localhost:5173\n/u)
  assert.deepEqual(overlay.match(/^ {6}- ".*"$/gmu), ['      - "127.0.0.1:${KERNEL_DEV_PORT:-3000}:3000"'])
})

void test("production: no Warden, no public port, PUBLIC_ORIGIN and the image tag required, Caddy opt-in on app", () => {
  const compose = source("compose.prod.yaml")
  assert.deepEqual(services(compose), ["db", "migrate", "app", "caddy"])
  assert.doesNotMatch(code("compose.prod.yaml"), /warden|traefik/iu)
  const app = serviceBlock(compose, "app")
  assert.match(app, /PUBLIC_ORIGIN: \$\{PUBLIC_ORIGIN:\?/u)
  assert.doesNotMatch(app, /ports:/u)
  for (const name of ["migrate", "app"]) {
    assert.match(serviceBlock(compose, name), /image: \$\{QWBE_IMAGE:-[^}]+\}:\$\{IMAGE_TAG:\?/u, `${name} image`)
  }
  for (const secret of ["AUTH_TOKEN_PATH", "PG_PASSWORD_PATH", "COMPANY_LOOKUP_KEY_PATH"]) {
    assert.match(compose, new RegExp(`\\$\\{${secret}:\\?`, "u"))
  }
  // The active database and artifact volume, switched together by scripts/production/restore.sh.
  assert.match(compose, /^ {2}PGDATABASE: \$\{QWBE_PGDATABASE:\?/mu)
  assert.match(compose, /^ {2}invoicing-data:\n {4}name: \$\{QWBE_DATA_VOLUME:\?/mu)
  const caddy = serviceBlock(compose, "caddy")
  assert.match(caddy, /profiles: \["proxy"\]/u)
  assert.match(caddy, /depends_on:\n {6}app:\n {8}condition: service_healthy\n {4}ports:/u, "Caddy waits for app, and only for app")
})

void test("an existing proxy reaches app through the loopback overlay, never a public address", () => {
  const overlay = source("compose.loopback.yaml")
  assert.deepEqual(services(overlay), ["app"])
  assert.deepEqual(overlay.match(/^ {6}- ".*"$/gmu), ['      - "127.0.0.1:${APP_LOOPBACK_PORT:?Set APP_LOOPBACK_PORT to a free port on this host, e.g. 3180}:3000"'])
})

void test("preview is opt-in, loopback-only on app, and isolates storage and credentials", () => {
  const compose = source("compose.preview.yaml")
  const roster = services(compose)
  assert.deepEqual(roster, ["db", "migrate", "app"])
  for (const name of roster) {
    assert.match(serviceBlock(compose, name), /profiles: \[preview\]/u,
      `${name} must be opt-in: nothing in compose.preview.yaml may start without the preview profile`)
  }
  assert.equal((compose.match(/profiles: \[preview\]/gu) ?? []).length, roster.length)
  const app = serviceBlock(compose, "app")
  // Docker's default 10 s would race the application's own 10 s shutdown deadline.
  assert.match(app, /stop_grace_period: 15s/u)
  assert.match(app, /ports:\n {6}- "127\.0\.0\.1:\$\{PREVIEW_PORT:-3181\}:3000"/u)
  assert.match(app, /PUBLIC_ORIGIN: \$\{PREVIEW_ORIGIN:-http:\/\/invoicing-preview\.localhost:3181\}/u)
  assert.match(app, /secrets: \[preview_api_token, preview_pg_password, preview_company_lookup_key\]/u)
  assert.equal((compose.match(/ports:/gu) ?? []).length, 1, "only app publishes, and only on loopback")
  const db = serviceBlock(compose, "db")
  assert.match(db, /secrets: \[preview_pg_password\]/u)
  assert.match(db, /POSTGRES_PASSWORD_FILE: \/run\/secrets\/preview_pg_password/u)
  assert.match(db, /preview-postgres:/u)
  assert.match(compose, /name: qwbe-invoicing-preview/u)
  assert.match(compose, /PREVIEW_AUTH_TOKEN_PATH:\?/u)
  assert.doesNotMatch(compose, /external:|name:.*invoicing-data|AUTH_TOKEN_PATH:-|network_mode: host|warden/u)
})

void test("the test rigs leave PUBLIC_ORIGIN to the fixtures and carry no Next build", () => {
  for (const name of ["compose.verify.yaml", "compose.test.yaml"]) {
    assert.doesNotMatch(source(name), /^ +PUBLIC_ORIGIN:/mu, `${name}: a fixed origin would refuse the ephemeral fixtures`)
  }
  assert.doesNotMatch(source("compose.verify.yaml"), /next build/u)
  assert.doesNotMatch(source("Dockerfile.verify"), /\.next|openssl/u)
})

void test("Caddy proxies to app, keeps Host and the scheme, and sends no referrer", () => {
  const caddy = source("Caddyfile.example")
  assert.match(caddy, /reverse_proxy app:3000 \{/u)
  assert.match(caddy, /header_up Host \{host\}/u)
  assert.match(caddy, /header_up X-Forwarded-Proto \{scheme\}/u)
  assert.match(caddy, /Referrer-Policy "no-referrer"/u)
  assert.doesNotMatch(caddy, /frontend/u)
})

void test("the build context excludes env files anywhere and the host's frontend build", () => {
  const ignored = source(".dockerignore").split("\n")
  for (const entry of ["**/.env", "**/.env.*", "frontend/dist", "frontend/.tanstack", "**/node_modules", ".local"]) {
    assert.ok(ignored.includes(entry), `.dockerignore must list ${entry}`)
  }
  assert.ok(!ignored.some((entry) => entry.includes(".next") || entry.includes("next-env")))
  // The operator's copies next to compose.prod.yaml stay out of git.
  const untracked = source(".gitignore").split("\n")
  for (const entry of ["Caddyfile", "image-digests.txt"]) assert.ok(untracked.includes(entry), `.gitignore must list ${entry}`)
})

void test("the release publishes one image and verifies through the Docker harness", () => {
  const release = source(".github/workflows/release.yaml")
  assert.equal((release.match(/docker\/build-push-action/gu) ?? []).length, 1)
  assert.doesNotMatch(release, /-frontend|frontend\/Dockerfile/u)
  assert.match(release, /run: scripts\/verify-docker\.sh verify/u)
  assert.doesNotMatch(release, /run: pnpm verify/u, "pnpm verify needs PostgreSQL; the runner has none")
  const digests = source("image-digests.txt.example").split("\n").filter((line) => line !== "" && !line.startsWith("#"))
  assert.equal(digests.length, 2, "the version, then one digest")
  assert.match(digests[1] ?? "", /\/qwbe-invoicing@sha256:[0-9a-f]{64}$/u)
})

void test("ANAF: the environment is test unless written out; the client and its secrets come only with the overlay, all required", () => {
  for (const name of ["compose.yaml", "compose.prod.yaml"]) {
    const app = serviceBlock(code(name), "app")
    assert.match(app, /ANAF_ENVIRONMENT: \$\{ANAF_ENVIRONMENT:-test\}/u, name)
    assert.doesNotMatch(code(name), /ANAF_CLIENT|ANAF_REDIRECT|ANAF_TOKEN|anaf_/u, `${name} carries no ANAF client`)
  }
  const overlay = code("compose.anaf.yaml")
  assert.deepEqual(services(overlay), ["app"])
  for (const variable of ["ANAF_CLIENT_ID", "ANAF_REDIRECT_URI", "ANAF_CLIENT_SECRET_PATH", "ANAF_TOKEN_KEY_PATH"]) {
    assert.match(overlay, new RegExp(`\\$\\{${variable}:\\?`, "u"), variable)
  }
  // Secrets travel as mounted files, never as environment values.
  assert.match(overlay, /ANAF_CLIENT_SECRET_FILE: \/run\/secrets\/anaf_client_secret\n/u)
  assert.match(overlay, /ANAF_TOKEN_KEY_FILE: \/run\/secrets\/anaf_token_key\n/u)
  assert.doesNotMatch(overlay, /ANAF_CLIENT_SECRET:|ANAF_ENVIRONMENT/u)
})
