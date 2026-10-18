import assert from "node:assert/strict"
import test from "node:test"

import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"

/**
 * The VAT treatment matrix, enforced by the storage itself on PostgreSQL 16.
 *
 * Two things the port had to change and nothing else. `PRAGMA foreign_keys=OFF`
 * became `session_replication_role = replica`, which is what suspends the
 * foreign-key triggers here — the rows below deliberately reference documents
 * that do not exist, because the subject is the CHECK, not the reference. And a
 * refusal is now identified by its SQLSTATE and the constraint's own name
 * instead of by SQLite's `CHECK constraint failed` phrasing: every one of these
 * CHECKs carries a deterministic name, so the assertion names the rule that
 * fired rather than matching a message.
 *
 * `STRICT` has no PostgreSQL equivalent and the trailing `STRICT` assertion
 * could not survive. What it was really protecting — money kept character for
 * character and a nullable exemption reason — is asserted from the catalogue
 * instead: the money columns are `text`, so no numeric coercion exists to lose
 * a trailing zero or a sign.
 */

const reason = "Regim special de scutire conform art. 310 din Codul fiscal"

const refusedBy = async (sql: RawSql, statement: string, constraint: string, values?: ReadonlyArray<unknown>) => {
  const failure = await sql.rejects(statement, values)
  assert.equal(failure.code, "23514", statement)
  assert.equal(failure.constraint, constraint, statement)
}

void test("020 enforces canonical S/O treatment tuples in every persistent VAT table", async () => {
  await withMigrated("vat_treatment", async ({ sql }) => {
    await sql.withoutTriggers(async (scoped) => {
      const lineInserts = [
        [`INSERT INTO draft_lines(id,draft_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-draft','missing',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
          "draft_lines_tax_matrix"],
        [`INSERT INTO issued_lines(id,invoice_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-issued','missing',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
          "issued_lines_tax_matrix"],
        [`INSERT INTO proforma_lines(id,proforma_id,organization_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-proforma','missing','org',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
          "proforma_lines_tax_matrix"],
        [`INSERT INTO correction_lines(id,correction_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-correction','missing',0,'X','1.0000','-1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'-1.00','-0.21','-1.21')`,
          "correction_lines_tax_matrix"],
      ] as const
      for (const [statement, constraint] of lineInserts) await refusedBy(scoped, statement, constraint)

      const breakdownInserts = [
        [`INSERT INTO issued_tax_breakdown VALUES('missing',0,'RO_NON_VAT','E','0.00',NULL,'1.00','0.00')`,
          "issued_tax_breakdown_tax_matrix"],
        [`INSERT INTO proforma_tax_breakdown VALUES('missing','org',0,'RO_NON_VAT','E','0.00',NULL,'1.00','0.00')`,
          "proforma_tax_breakdown_tax_matrix"],
        [`INSERT INTO correction_tax_breakdown VALUES('missing',0,'RO_NON_VAT','E','0.00',NULL,'-1.00','-0.00')`,
          "correction_tax_breakdown_tax_matrix"],
      ] as const
      for (const [statement, constraint] of breakdownInserts) await refusedBy(scoped, statement, constraint)

      // The exempt category is refused even when everything else about the row
      // is the canonical article 310 tuple: the treatment this product issues is
      // `O`, and the database is the last place that can still say so.
      await refusedBy(scoped, `INSERT INTO correction_tax_breakdown
        (correction_id,line_position,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount)
        VALUES('missing',1,'RO_NON_VAT','E','0.00',$1,'-1.00','-0.00')`, "correction_tax_breakdown_tax_matrix", [reason])
      await refusedBy(scoped, `INSERT INTO correction_tax_breakdown
        (correction_id,line_position,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount)
        VALUES('missing',2,'RO_NON_VAT','O','0.00',NULL,'-1.00','-0.00')`, "correction_tax_breakdown_tax_matrix")
      await refusedBy(scoped, `INSERT INTO issuer_tax_configurations
        (organization_id,code,category,rate,vat_exemption_reason,effective_from)
        VALUES('missing','RO_NON_VAT','E','0.00',NULL,'2026-01-01')`, "issuer_tax_configurations_rate_matrix")

      await scoped.exec(`INSERT INTO correction_lines(id,correction_id,line_position,description,quantity,unit_price,unit_code,unit_name,
        tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
        VALUES('valid-zero','missing',0,'X','1.0000','-1.00','C62','unitate','RO_NON_VAT','O','0.00','${reason}','-1.00','-0.00','-1.00')`)
      await scoped.exec(`INSERT INTO correction_tax_breakdown
        (correction_id,line_position,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount)
        VALUES('missing',0,'RO_NON_VAT','O','0.00','${reason}','-1.00','-0.00')`)
    })
    // Read outside the replica session: the row survived its own transaction and
    // the negative zero is still the characters the writer bound.
    assert.equal(await sql.scalar("SELECT tax_amount FROM correction_lines WHERE id='valid-zero'"), "-0.00")

    for (const table of ["issuer_tax_configurations", "draft_lines", "issued_lines", "issued_tax_breakdown",
      "proforma_lines", "proforma_tax_breakdown", "correction_lines", "correction_tax_breakdown"]) {
      const matrix = `${table === "issuer_tax_configurations" ? `${table}_rate` : `${table}_tax`}_matrix`
      assert.ok((await sql.checkNames(table)).includes(matrix), table)
      // The named CHECK really is the treatment matrix: `RO_NON_VAT` and the
      // exemption reason both appear in the definition the catalogue hands back.
      const definition = String(await sql.scalar(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass",
        [matrix, table],
      ))
      assert.ok(definition.includes("RO_NON_VAT"), `${table}: ${definition}`)
      assert.ok(definition.includes("vat_exemption_reason"), `${table}: ${definition}`)
      const columns = await sql.query<{ readonly column_name: string; readonly data_type: string; readonly is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'vat_exemption_reason'`,
        [table],
      )
      assert.deepEqual(columns, [{ column_name: "vat_exemption_reason", data_type: "text", is_nullable: "YES" }], table)
    }
    // What `STRICT` was protecting here: money is characters, not a numeric the
    // engine may normalise, so `-0.00` above could be read back unchanged.
    const money = await sql.query<{ readonly data_type: string }>(
      `SELECT DISTINCT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('tax_amount','taxable_amount','total_including_tax','rate','tax_rate')`,
    )
    assert.deepEqual(money, [{ data_type: "text" }])
  })
})
