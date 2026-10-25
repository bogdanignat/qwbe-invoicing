import assert from "node:assert/strict"
import test from "node:test"

import { numberingService, run } from "./numbering.test-support.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"

/**
 * T-2081 in the schema: the year is not part of any document's unique number.
 * Each document is cloned under a new id into the next year; the same series and
 * number is refused, a different number is accepted, so the refusal comes from
 * the numbering key and nothing else. Invoices and stornos sit in two tables:
 * between them uniqueness is the shared "invoice" counter's, not a constraint's.
 */

/** The clone statement: $1 the new id, $2 the source id, $3 what is added to the number. */
const cloneIntoNextYear = async (sql: RawSql, table: string) => {
  const columns = (await sql.query<{ readonly column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
       AND is_generated='NEVER' AND column_name NOT IN ('id','fiscal_year','issue_date','number') ORDER BY ordinal_position`,
    [table],
  )).map(({ column_name }) => column_name).join(",")
  return `INSERT INTO ${table}(id,fiscal_year,issue_date,number,${columns})
    SELECT $1,fiscal_year+1,'2027-01-02',number+$3::integer,${columns} FROM ${table} WHERE id=$2`
}

void test("every document table refuses the same series and number in another year", async () => {
  await withMigrated("numbering_unique", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const invoice = await run(org.invoice("2026-12-31"))
    const storno = await run(org.storno(invoice.id, "2026-12-31"))
    const proforma = await run(org.proforma("2026-12-31"))
    for (const [table, id] of [["issued_invoices", invoice.id], ["correction_documents", storno.id], ["proformas", proforma.id]] as const) {
      const clone = await cloneIntoNextYear(sql, table)
      const refused = await sql.rejects(clone, [`${id}-same`, id, 0])
      assert.equal(refused.code, "23505", `${table}: ${refused.message}`)
      assert.equal(await sql.rowCount(clone, [`${id}-other`, id, 100]), 1, table)
    }
  })
})

void test("the counter has no year: one row per organization, document type and series", async () => {
  await withMigrated("numbering_counter", async ({ sql }) => {
    const columns = await sql.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='invoice_sequences' ORDER BY ordinal_position`)
    assert.deepEqual(columns.map(({ column_name }) => column_name), ["organization_id", "document_type", "series", "last_number"])
    await sql.query("INSERT INTO invoice_sequences VALUES('org-1','invoice','FCT',1)")
    assert.equal((await sql.rejects("INSERT INTO invoice_sequences VALUES('org-1','invoice','FCT',2)")).code, "23505")
  })
})
