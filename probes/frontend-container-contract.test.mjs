import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { URL } from "node:url"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("frontend image uses the traced workspace layout with runtime validation", () => {
  const docker = source("frontend/Dockerfile")
  assert.match(docker, /COPY --from=builder \/app\/frontend\/\.next\/standalone \.\//)
  assert.match(docker, /COPY --from=builder \/app\/frontend\/\.next\/static \.\/frontend\/\.next\/static/)
  assert.match(docker, /HOSTNAME=0\.0\.0\.0/)
  assert.match(docker, /USER node/)
  assert.match(docker, /"--import", "\.\/frontend\/scripts\/validate-runtime\.mjs", "frontend\/server\.js"/)
  assert.doesNotMatch(docker, /AUTH_TOKEN|COPY \. \./)
})

/**
 * The services of a compose file, in order, by their two-space indentation under
 * `services:`. A name count cannot say WHICH service is opt-in, and the previous
 * `=== 3` broke the moment preview grew its own `db`: the point was never the
 * number but that no service in this file can start without the profile.
 */
const previewServices = (compose) => {
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

test("preview is opt-in and isolates backend storage and credentials", () => {
  const compose = source("compose.preview.yaml")
  // Preview now carries its own PostgreSQL, so the contract is per service: each
  // one declares the profile, and the roster is closed.
  const services = previewServices(compose)
  assert.deepEqual(services, ["db", "migrate-fixture", "backend-fixture", "frontend"])
  for (const name of services) {
    assert.match(
      serviceBlock(compose, name),
      /profiles: \[preview\]/u,
      `${name} must be opt-in: nothing in compose.preview.yaml may start without the preview profile`,
    )
  }
  assert.equal((compose.match(/profiles: \[preview\]/gu) ?? []).length, services.length)
  // The new database is a preview fixture, not a shared one: its own volume, its
  // own synthetic secret, no published port.
  const db = serviceBlock(compose, "db")
  assert.match(db, /secrets: \[preview_pg_password\]/u)
  assert.match(db, /POSTGRES_PASSWORD_FILE: \/run\/secrets\/preview_pg_password/u)
  assert.match(db, /preview-postgres:/u)
  assert.doesNotMatch(db, /ports:/u)
  assert.match(compose, /name: qwbe-invoicing-preview/)
  assert.match(compose, /127\.0\.0\.1:\$\{PREVIEW_PORT:-3181\}:3000/)
  assert.match(compose, /PREVIEW_AUTH_TOKEN_PATH:\?/)
  assert.doesNotMatch(compose, /external:|name:.*invoicing-data|AUTH_TOKEN_PATH:-|network_mode: host/)
  const frontend = compose.split("  frontend:")[1]?.split("\nsecrets:")[0] ?? ""
  assert.doesNotMatch(frontend, /secrets:|preview-data|AUTH_TOKEN_FILE|depends_on:/)
})
