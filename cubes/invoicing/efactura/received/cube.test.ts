import assert from "node:assert/strict"
import test from "node:test"

import { cube, receivedMigrations } from "./index.ts"

const statements = receivedMigrations.flatMap((migration) => migration.statements)

void test("declares received as a required child of e-Factura, owning exactly the tables its baseline creates and granting efactura:receive", () => {
  assert.equal(cube.manifest.name, "received")
  assert.deepEqual(cube.manifest.permissions, [{ name: "efactura:receive", roles: ["admin"] }])
  assert.equal(cube.manifest.parent, "efactura")
  assert.equal(cube.manifest.required, true)
  assert.deepEqual(receivedMigrations.map(({ name }) => name), ["efactura-received-001-baseline"])
  const created = statements.map((sql) => /^CREATE TABLE (\w+)\(/u.exec(sql)?.[1]).filter((name) => name !== undefined)
  assert.deepEqual(created, cube.manifest.tables)
  assert.deepEqual(cube.manifest.tables, [
    "efactura_received_fetches", "efactura_received_messages", "efactura_received_archives", "efactura_received_invoices",
    "efactura_received_unreadable", "efactura_received_coverage",
  ])
})

void test("no column of the baseline is nullable, and the archive is guarded against change", () => {
  for (const sql of statements.filter((candidate) => candidate.startsWith("CREATE TABLE "))) {
    const columns = /\((.*)\)$/u.exec(sql)?.[1]?.split(/,(?=[a-z_]+ (?:TEXT|INTEGER|BIGINT|BYTEA|JSONB) )/u) ?? []
    assert.ok(columns.length >= 3, sql)
    for (const column of columns.filter((part) => /^[a-z_]+ (?:TEXT|INTEGER|BIGINT|BYTEA|JSONB) /u.test(part))) {
      assert.match(column, /NOT NULL|PRIMARY KEY/u, column)
    }
  }
  for (const event of ["UPDATE", "DELETE"]) {
    assert.ok(statements.some((sql) => sql.startsWith(`CREATE TRIGGER efactura_received_archives_no_${event.toLowerCase()} BEFORE ${event} `)))
  }
})
