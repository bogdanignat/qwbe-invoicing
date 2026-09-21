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

test("preview is opt-in and isolates backend storage and credentials", () => {
  const compose = source("compose.preview.yaml")
  assert.equal((compose.match(/profiles: \[preview\]/g) ?? []).length, 3)
  assert.match(compose, /name: qwbe-invoicing-preview/)
  assert.match(compose, /127\.0\.0\.1:\$\{PREVIEW_PORT:-3181\}:3000/)
  assert.match(compose, /PREVIEW_AUTH_TOKEN_PATH:\?/)
  assert.doesNotMatch(compose, /external:|name:.*invoicing-data|AUTH_TOKEN_PATH:-|network_mode: host/)
  const frontend = compose.split("  frontend:")[1]?.split("\nsecrets:")[0] ?? ""
  assert.doesNotMatch(frontend, /secrets:|preview-data|AUTH_TOKEN_FILE|depends_on:/)
})
