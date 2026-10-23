import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import type { ReceivedDocument } from "../../cubes/invoicing/efactura/received-ubl/index.ts"
import { AnafEnvironmentMismatch, assertAnafEnvironment } from "../efactura/anaf/environment-guard.ts"
import { saveInterpretation } from "./postgres-efactura-received-archive.ts"
import { efacturaSubmissionsLockKey } from "./postgres-efactura-submission-rows.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

const AT = "2026-10-23T10:00:00.000Z"
const ZIP = Buffer.from("PK\u0003\u0004 archive")

const fetchRow = (sql: RawSql, id: string, environment = "test", state = "listing") => sql.query(`INSERT INTO efactura_received_fetches(id,
  organization_id,environment,cif,window_start,window_end,gap_start,gap_end,state,next_attempt_at,created_by,created_at,updated_at)
  VALUES($1,'org-1',$2,'12345674','2026-08-24T10:00:00.000Z',$3,'2026-08-24T10:00:00.000Z','2026-08-24T10:00:00.000Z',$4,$3,'user-1',$3,$3)`,
[id, environment, AT, state])

const stored = async (sql: RawSql) => {
  await fetchRow(sql, "f-1")
  await sql.query(`INSERT INTO efactura_received_messages(organization_id,environment,anaf_message_id,upload_index,cif,details,anaf_created,
    fetch_id,state,next_attempt_at,listed_at,updated_at) VALUES('org-1','test','4000000001','5100000001','12345674','',
    '202610231015','f-1','stored',$1,$1,$1)`, [AT])
  await sql.query(`INSERT INTO efactura_received_archives(organization_id,environment,anaf_message_id,archive,sha256,size,stored_at)
    VALUES('org-1','test','4000000001',$1::bytea,encode(sha256($1::bytea),'hex'),octet_length($1::bytea),$2)`, [ZIP, AT])
}

void test("a received archive is kept exactly as it came: no update, no delete, its digest and size are its own", async () => {
  await withMigrated("received_archive", async ({ sql }) => {
    await stored(sql)
    for (const statement of ["UPDATE efactura_received_archives SET stored_at='x'", "DELETE FROM efactura_received_archives"]) {
      assert.match((await sql.rejects(statement)).message, /received e-Factura archives are immutable/u, statement)
    }
    const forged = await sql.rejects(`INSERT INTO efactura_received_archives(organization_id,environment,anaf_message_id,archive,sha256,size,stored_at)
      VALUES('org-1','test','4000000002',$1::bytea,'00',octet_length($1::bytea),$2)`, [ZIP, AT])
    assert.equal(forged.constraint, "efactura_received_archives_sha256_matches")
  })
})

void test("one active fetch per organization and environment; a finished one makes room", async () => {
  await withMigrated("received_active", async ({ sql }) => {
    await fetchRow(sql, "f-1")
    assert.equal((await sql.rejects(...[`INSERT INTO efactura_received_fetches(id,organization_id,environment,cif,window_start,window_end,gap_start,
      gap_end,state,next_attempt_at,created_by,created_at,updated_at) SELECT 'f-2',organization_id,environment,cif,window_start,window_end,gap_start,
      gap_end,'downloading',next_attempt_at,created_by,created_at,updated_at FROM efactura_received_fetches WHERE id='f-1'`])).constraint,
    "efactura_received_fetches_active")
    await fetchRow(sql, "f-3", "prod")
    await sql.query("UPDATE efactura_received_fetches SET state='completed' WHERE id='f-1'")
    await fetchRow(sql, "f-4")
  })
})

void test("a reading is replaced, never added to: an unreadable archive read again becomes one invoice row", async () => {
  await withMigrated("received_reread", async ({ pool, sql }) => {
    await stored(sql)
    const key = { organizationId: "org-1", environment: "test", messageId: "4000000001" } as const
    const save = (interpretation: Parameters<typeof saveInterpretation>[2]) => Effect.runPromise(transactionWith(pool, {
      lock: efacturaSubmissionsLockKey, adapter: (client: TransactionClient) => client, onBeginFailure: () => new Error("begin"), onCommitFailure: () => new Error("commit"),
    })((client) => Effect.promise(() => saveInterpretation(client, key, interpretation, AT))))
    await save({ readable: false, reason: { source: "encoding" } })
    await save({ readable: false, reason: { source: "zip", refusal: "crc" } })
    assert.deepEqual(await sql.query("SELECT reason FROM efactura_received_unreadable"), [{ reason: { source: "zip", refusal: "crc" } }])
    const listing = { kind: "invoice", number: "R-1", issueDate: "2026-10-01", currency: "RON", supplierName: "F", supplierCif: "RO1",
      totalExcludingTax: "-10.50", taxTotal: "0.00", payable: "-10.50" } as const
    const document = { kind: "invoice", number: "R-1" } as unknown as ReceivedDocument
    await save({ readable: true, listing, document, warnings: [] })
    assert.deepEqual(await sql.query("SELECT count(*)::int AS n FROM efactura_received_unreadable"), [{ n: 0 }])
    assert.deepEqual(await sql.query("SELECT number,total_excluding_tax,payable,content FROM efactura_received_invoices"),
      [{ number: "R-1", total_excluding_tax: "-1050", payable: "-1050", content: { kind: "invoice", number: "R-1" } }])
  })
})

void test("serve's environment guard counts received invoices too: a fetch on the other environment refuses it", async () => {
  await withMigrated("received_guard", async ({ pool, sql }) => {
    await fetchRow(sql, "f-1", "prod", "completed")
    await assertAnafEnvironment(pool, "prod")
    await assert.rejects(assertAnafEnvironment(pool, "test"), (error: Error) =>
      error instanceof AnafEnvironmentMismatch && /e-Factura data \(submissions or received invoices\) exists for prod/u.test(error.message))
  })
})
