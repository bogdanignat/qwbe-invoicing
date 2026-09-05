import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { executeBackup, executeRestore } from "./backup.ts"
import { applyMigrations, databasePath } from "./migrations.ts"

const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-restore-"))

void test("restore replaces databases in place and clears stale SQLite sidecars", () => {
  const source = fixture()
  const target = fixture()
  try {
    applyMigrations(source)
    const archive = join(source, "backup.tar.gz")
    executeBackup(source, archive)
    applyMigrations(target)
    writeFileSync(`${databasePath(target)}-wal`, "stale")
    writeFileSync(`${databasePath(target)}-shm`, "stale")
    const report = executeRestore(target, archive)
    assert.equal(report.restored, report.scanned)
    assert.equal(existsSync(`${databasePath(target)}-wal`), false)
    assert.equal(existsSync(`${databasePath(target)}-shm`), false)
    assert.equal(readdirSync(target).some((name) => name.includes(".restore-")), false)
    const database = new DatabaseSync(databasePath(target), { readOnly: true })
    try {
      assert.ok(database.prepare("SELECT count(*) AS n FROM schema_migrations").get() !== undefined)
    } finally {
      database.close()
    }
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

void test("restore refuses to overwrite a database that another connection is writing", () => {
  const source = fixture()
  const target = fixture()
  try {
    applyMigrations(source)
    const archive = join(source, "backup.tar.gz")
    executeBackup(source, archive)
    applyMigrations(target)
    const writer = new DatabaseSync(databasePath(target))
    try {
      writer.exec("BEGIN IMMEDIATE")
      assert.throws(() => executeRestore(target, archive), /database is in use/)
    } finally {
      writer.exec("ROLLBACK")
      writer.close()
    }
    assert.equal(existsSync(databasePath(target)), true)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})
