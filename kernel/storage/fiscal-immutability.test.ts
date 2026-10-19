import assert from "node:assert/strict"
import test from "node:test"

import { dispatchRig } from "../efactura/dispatch/dispatch.test-support.ts"
import { ok } from "../http/plugins-http.test-support.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"

/**
 * The fiscal snapshot never changes; the e-Factura status is the one column
 * an issued invoice and a correction may change. The columns are read from the
 * live schema, so a column added later is covered without touching this test.
 */
void test("every fiscal column of an issued invoice and of a correction refuses an UPDATE; e_factura_status alone may change",
  () => withMigrated("fiscal_immutability", async (fixture) => {
    const rig = await dispatchRig(fixture)
    try {
      const invoiceId = await rig.invoice("inv-1")
      const storno = await ok(rig.server.call("POST", `/api/invoices/${invoiceId}/corrections`, { reason: "Anulare" }, "storno-1"), "storno")
      for (const [table, id] of [["issued_invoices", invoiceId], ["correction_documents", String(storno.id)]] as const) {
        const columns = (await rig.sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
          AND is_generated='NEVER' AND column_name<>'e_factura_status' ORDER BY ordinal_position`, [table])).map((row) => String(row.column_name))
        assert.ok(columns.length > 30, `${table} has its fiscal columns`)
        for (const column of columns) {
          await assert.rejects(rig.sql(`UPDATE ${table} SET "${column}"="${column}" WHERE id=$1`, [id]), /immutable/u, `${table}.${column}`)
        }
        await rig.sql(`UPDATE ${table} SET e_factura_status='unknown' WHERE id=$1`, [id])
        assert.equal(await rig.status(table, id), "unknown")
        await assert.rejects(rig.sql(`UPDATE ${table} SET e_factura_status='sent' WHERE id=$1`, [id]), /e_factura_status/u, `${table} status values`)
      }
    } finally {
      await rig.close()
    }
  }))
