import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { parseCommand } from "./cli.ts"
import { route } from "./http.ts"
import { applyMigrations, databaseReady, planMigrations } from "./migrations.ts"
import { staticUiResponse } from "./static-ui.ts"

void test("migration apply is idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-migrations-"))
  try {
    assert.deepEqual(planMigrations(directory).pending, [
      "000-foundation",
      "001-invoice-core",
      "002-invoice-payments",
      "003-invoice-corrections",
      "004-invoice-delete-last",
      "005-allow-e-factura-status-update",
      "006-customer-soft-delete",
      "007-complete-invoice-authoring",
      "documents/000-foundation",
      "documents/001-artifacts",
      "sessions/000-browser-sessions",
    ])
    assert.equal(applyMigrations(directory).changed, 11)
    assert.equal(applyMigrations(directory).changed, 0)
    assert.equal(databaseReady(directory), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("readiness fails when migrated storage loses write access", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-readiness-"))
  const database = join(directory, "invoicing.sqlite")
  try {
    applyMigrations(directory)
    chmodSync(database, 0o444)
    chmodSync(directory, 0o555)
    assert.equal(databaseReady(directory), false)
  } finally {
    chmodSync(directory, 0o755)
    chmodSync(database, 0o644)
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("migrate remains dry-run unless apply is explicit", () => {
  assert.deepEqual(parseCommand(["migrate", "--json"]), {
    name: "migrate",
    apply: false,
    confirmProduction: false,
    json: true,
  })
})

void test("artifact reconciliation is bounded and dry-run unless apply is explicit", () => {
  assert.deepEqual(parseCommand(["artifacts", "--limit", "25", "--json"]), {
    name: "artifacts",
    apply: false,
    confirmProduction: false,
    json: true,
    limit: 25,
  })
  assert.throws(() => parseCommand(["artifacts", "--limit", "101"]))
})

void test("CLI distinguishes invalid input, guard refusal, and execution failure", () => {
  const executable = join(process.cwd(), "bin", "qwbe-invoicing.ts")
  const directory = mkdtempSync(join(tmpdir(), "qwbe-cli-"))
  const invalidDataPath = join(directory, "not-a-directory")
  writeFileSync(invalidDataPath, "occupied")
  try {
    const invalid = spawnSync(process.execPath, [executable, "unknown"], { encoding: "utf8" })
    assert.equal(invalid.status, 2)

    const refused = spawnSync(process.execPath, [executable, "migrate", "--apply"], {
      encoding: "utf8",
      env: { ...process.env, DATA_DIR: directory, NODE_ENV: "production" },
    })
    assert.equal(refused.status, 2)

    const failed = spawnSync(process.execPath, [executable, "migrate", "--apply"], {
      encoding: "utf8",
      env: { ...process.env, DATA_DIR: invalidDataPath, NODE_ENV: "development" },
    })
    assert.equal(failed.status, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("readiness is observable over the HTTP contract", () => {
  assert.equal(route("GET", "/health/ready", false).status, 503)
  assert.equal(route("GET", "/health/ready", true).status, 200)
  assert.equal(route("POST", "/", true).status, 405)
})

void test("production Compose confirms the guarded migration apply", () => {
  const compose = readFileSync(join(process.cwd(), "compose.prod.yaml"), "utf8")
  assert.match(compose, /"migrate", "--apply", "--confirm-production", "--json"/)
})

void test("serves the UI only from an exact allowlist with restrictive headers", () => {
  assert.deepEqual(readdirSync(join(process.cwd(), "standalone/ui-dist")).sort(), ["assets", "index.html"])
  assert.deepEqual(readdirSync(join(process.cwd(), "standalone/ui-dist/assets")).sort(), ["app.css", "app.js"])
  const page = staticUiResponse("GET", "/app")
  assert.ok(page)
  assert.equal(page.status, 200)
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8")
  const contentSecurityPolicy = page.headers["content-security-policy"]
  assert.ok(contentSecurityPolicy)
  assert.match(contentSecurityPolicy, /default-src 'none'/)
  assert.match(Buffer.from(page.body).toString("utf8"), /QWBE Invoicing/)

  const script = staticUiResponse("HEAD", "/assets/app.js")
  assert.ok(script)
  assert.equal(script.status, 200)
  assert.equal(script.body.length, 0)
  assert.equal(script.headers["x-content-type-options"], "nosniff")
  const scriptBody = staticUiResponse("GET", "/assets/app.js")
  assert.ok(scriptBody)
  assert.equal(scriptBody.body.length > 1_000, true)
  assert.equal(staticUiResponse("GET", "/assets/app.css")?.status, 200)
  assert.equal(staticUiResponse("GET", "/assets/api-client.js"), undefined)
  assert.equal(staticUiResponse("GET", "/assets/../api-token"), undefined)
  assert.equal(staticUiResponse("GET", "/assets/%2e%2e/api-token"), undefined)
  assert.equal(staticUiResponse("POST", "/assets/app.js")?.status, 405)
})
