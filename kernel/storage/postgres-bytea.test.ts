import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { Effect } from "effect"

import { withMigrated } from "./postgres-rig.test-support.ts"
import { bytes, text } from "./postgres-rows.ts"
import { insertStatement, pairs } from "./postgres-sql.ts"
import { businessLockKey, transactionWith } from "./postgres-transaction.ts"

// Every byte value, NUL and invalid UTF-8 included: what ANAF receives is exactly what was stored.
const xml = new Uint8Array(Array.from({ length: 512 }, (_, index) => index % 256))

void test("exact bytes bind as Uint8Array through the query layer and read back from bytea unchanged", async () => {
  await withMigrated("bytea", async ({ pool }) => {
    const run = transactionWith(pool, {
      lock: businessLockKey,
      adapter: (client) => client,
      onBeginFailure: () => new Error("begin failed"),
      onCommitFailure: () => new Error("commit failed"),
    })
    const insert = insertStatement("efactura_submissions", pairs(
      ["id", "organization_id", "environment", "document_kind", "document_id", "standard", "cif", "buyer_is_individual", "xml", "xml_sha256",
        "xml_size", "state", "next_attempt_at", "created_by", "created_at", "updated_at"],
      ["s-1", "org-1", "test", "invoice", "inv-1", "UBL", "12345674", false, xml, createHash("sha256").update(xml).digest("hex"), xml.byteLength,
        "queued", "2026-10-19T10:00:00.000Z", "user-1", "2026-10-19T10:00:00.000Z", "2026-10-19T10:00:00.000Z"],
    ))
    const row = await Effect.runPromise(run((client) => Effect.promise(async () => {
      await client.query(insert.sql, insert.values)
      return (await client.query("SELECT xml, encode(sha256(xml),'hex') AS digest FROM efactura_submissions WHERE id=$1", ["s-1"])).rows[0]
    })))
    assert.ok(row !== undefined)
    const stored = bytes(row, "xml")
    assert.equal(stored.byteLength, 512)
    assert.equal(Buffer.compare(Buffer.from(stored), Buffer.from(xml)), 0)
    assert.equal(text(row, "digest"), createHash("sha256").update(xml).digest("hex"), "PostgreSQL hashed the same bytes")
  })
})

void test("the bytea reader refuses anything that is not bytes", () => {
  for (const value of ["\\x00ff", null, undefined, 1, [0, 1]]) assert.throws(() => bytes({ xml: value }, "xml"), /invalid xml/u, String(value))
})
