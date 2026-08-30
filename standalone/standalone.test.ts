import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { parseCommand } from "./cli.ts"
import { route } from "./http.ts"
import { applyMigrations, databaseReady, planMigrations } from "./migrations.ts"

void test("migration apply is idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-migrations-"))
  try {
    assert.deepEqual(planMigrations(directory).pending, ["000-foundation"])
    assert.equal(applyMigrations(directory).changed, 1)
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
