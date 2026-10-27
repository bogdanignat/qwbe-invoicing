import assert from "node:assert/strict"
import test from "node:test"

import type { Pool } from "pg"

import type { SchemaMigration } from "./postgres-foundation.ts"
import { migrationScopes } from "./postgres-migration-plans.ts"
import { applyMigrations, ledgerTable } from "./postgres-migrations.ts"
import { freshRuntime, type TestRuntime } from "./postgres-rig.test-support.ts"
import { resetFingerprintCache, schemaDrift } from "./postgres-schema-fingerprint.ts"
import { introspectSchema } from "./postgres-schema-introspection.ts"

/**
 * An upgrade, on a real PostgreSQL 16 server: a database with data, built from
 * the shipped migrations, receives one new migration at the end of a scope that
 * is not the last one, and `migrate` applies exactly that.
 *
 * The hook is the test's own: it appends to the catalog scope's array.
 * `migrationScopes` is what the executor, the ledger classifier and the drift
 * replay all read, the array is a plain one under its readonly type, and
 * `node --test` runs every file in its own process, so no other file sees the
 * appended migration. Production code has no seam for it and needs none.
 */

const backfill: SchemaMigration = {
  name: "catalog-002-test-description-length",
  statements: [
    "ALTER TABLE product_presets ADD COLUMN description_length INTEGER",
    "UPDATE product_presets SET description_length = length(description)",
    "ALTER TABLE product_presets ALTER COLUMN description_length SET NOT NULL",
  ],
}

const withAppended = async (migration: SchemaMigration, body: () => Promise<void>): Promise<void> => {
  const catalog = migrationScopes.find(({ scope }) => scope === "catalog")
  assert.ok(catalog !== undefined, "the catalog scope exists")
  const migrations = catalog.migrations as Array<SchemaMigration>
  migrations.push(migration)
  resetFingerprintCache()
  try {
    await body()
  } finally {
    migrations.pop()
    resetFingerprintCache()
  }
}

const ledger = async (pool: Pool): Promise<ReadonlyArray<string>> => {
  const { rows } = await pool.query<{ readonly key: string }>(
    `SELECT scope || '/' || name AS key FROM ${ledgerTable} ORDER BY scope, name`,
  )
  return rows.map(({ key }) => key)
}

interface PresetLength {
  readonly id: string
  readonly description_length: number
}

const presets = async (pool: Pool): Promise<ReadonlyArray<PresetLength>> =>
  (await pool.query<PresetLength>("SELECT id, description_length FROM product_presets ORDER BY id")).rows

const seed = async (pool: Pool): Promise<void> => {
  const insert = `INSERT INTO product_presets(id,organization_id,code,kind,description,unit_price,unit_code,unit_name)
    VALUES ($1,'org-upgrade',$2,'service',$3,1000,'H87','bucata')`
  await pool.query(insert, ["p-1", "CONS", "Consultanta"])
  await pool.query(insert, ["p-2", "LIC", "Licență software"])
}

const closeAll = async (runtimes: ReadonlyArray<TestRuntime | undefined>): Promise<void> => {
  for (const runtime of runtimes) await runtime?.close()
}

void test("an appended migration with a backfill upgrades a database with data like a new install", async () => {
  const upgraded = await freshRuntime("upgrade_data")
  let installed: TestRuntime | undefined
  try {
    await seed(upgraded.pool)
    const before = await ledger(upgraded.pool)
    await withAppended(backfill, async () => {
      // What `migrate` asks first: the old history still explains the schema.
      assert.deepEqual(await schemaDrift(upgraded.pool), [])
      const report = await applyMigrations(upgraded.pool)
      assert.equal(report.changed, 1)
      const after = await ledger(upgraded.pool)
      assert.deepEqual(after.filter((key) => !before.includes(key)), [`catalog/${backfill.name}`])
      assert.deepEqual(await presets(upgraded.pool), [
        { id: "p-1", description_length: 11 },
        { id: "p-2", description_length: 16 },
      ])
      assert.deepEqual(await schemaDrift(upgraded.pool), [])

      const again = await applyMigrations(upgraded.pool)
      assert.equal(again.changed, 0)
      assert.deepEqual(await ledger(upgraded.pool), after)
      assert.equal((await presets(upgraded.pool)).length, 2)
      assert.deepEqual(await schemaDrift(upgraded.pool), [])

      installed = await freshRuntime("upgrade_install")
      assert.deepEqual(await ledger(installed.pool), after)
      assert.deepEqual(await schemaDrift(installed.pool), [])
      assert.deepEqual(
        await introspectSchema(installed.pool, "public"),
        await introspectSchema(upgraded.pool, "public"),
        "a new install and an upgraded database have the same schema",
      )
    })
  } finally {
    await closeAll([upgraded, installed])
  }
})

void test("a migration statement may outlive the pool's statement_timeout, and only a migration", async () => {
  const runtime = await freshRuntime("upgrade_budget")
  try {
    // The rig's pool gives a statement 4 s; a backfill longer than that must finish.
    await withAppended({ name: "catalog-002-test-slow", statements: ["SELECT pg_sleep(4.5)"] }, async () => {
      assert.equal((await applyMigrations(runtime.pool)).changed, 1)
    })
    // `SET LOCAL` ended with the migration: every connection of the pool, the one
    // that ran it included, is back on the pool's own bounds.
    const clients = await Promise.all([1, 2, 3, 4].map(() => runtime.pool.connect()))
    try {
      for (const client of clients) {
        const statement = await client.query<{ readonly statement_timeout: string }>("SHOW statement_timeout")
        const lock = await client.query<{ readonly lock_timeout: string }>("SHOW lock_timeout")
        assert.equal(statement.rows[0]?.statement_timeout, "4s")
        assert.equal(lock.rows[0]?.lock_timeout, "3s")
      }
    } finally {
      for (const client of clients) client.release()
    }
  } finally {
    await runtime.close()
  }
})
