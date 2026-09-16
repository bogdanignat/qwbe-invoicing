import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { applyMigrations, databasePath } from "./migrations.ts"

const reason = "Regim special de scutire conform art. 310 din Codul fiscal"

void test("020 enforces canonical S/E treatment tuples in every persistent VAT table", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-vat-treatment-schema-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys=OFF")
      const lineInserts = [
        `INSERT INTO draft_lines(id,draft_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-draft','missing',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
        `INSERT INTO issued_lines(id,invoice_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-issued','missing',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
        `INSERT INTO proforma_lines(id,proforma_id,organization_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-proforma','missing','org',0,'X','1.0000','1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'1.00','0.21','1.21')`,
        `INSERT INTO correction_lines(id,correction_id,line_position,description,quantity,unit_price,unit_code,unit_name,
          tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
          VALUES('bad-correction','missing',0,'X','1.0000','-1.00','C62','unitate','RO_STANDARD','E','21.00',NULL,'-1.00','-0.21','-1.21')`,
      ]
      for (const statement of lineInserts) assert.throws(() => { database.exec(statement) }, /CHECK constraint failed/)

      const breakdownInserts = [
        `INSERT INTO issued_tax_breakdown VALUES('missing',0,'RO_NON_VAT','E','0.00',NULL,'1.00','0.00')`,
        `INSERT INTO proforma_tax_breakdown VALUES('missing','org',0,'RO_NON_VAT','E','0.00',NULL,'1.00','0.00')`,
        `INSERT INTO correction_tax_breakdown VALUES('missing',0,'RO_NON_VAT','E','0.00',NULL,'-1.00','-0.00')`,
      ]
      for (const statement of breakdownInserts) assert.throws(() => { database.exec(statement) }, /CHECK constraint failed/)
      assert.throws(() => database.prepare(`INSERT INTO issuer_tax_configurations
        (organization_id,code,category,rate,vat_exemption_reason,effective_from)
        VALUES('missing','RO_NON_VAT','E','0.00',NULL,'2026-01-01')`).run(), /CHECK constraint failed/)

      database.prepare(`INSERT INTO correction_lines(id,correction_id,line_position,description,quantity,unit_price,unit_code,unit_name,
        tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax)
        VALUES('valid-zero','missing',0,'X','1.0000','-1.00','C62','unitate','RO_NON_VAT','E','0.00',?,'-1.00','-0.00','-1.00')`).run(reason)
      database.prepare(`INSERT INTO correction_tax_breakdown
        (correction_id,line_position,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount)
        VALUES('missing',0,'RO_NON_VAT','E','0.00',?,'-1.00','-0.00')`).run(reason)
      assert.equal(database.prepare("SELECT tax_amount FROM correction_lines WHERE id='valid-zero'").get()?.tax_amount, "-0.00")

      for (const table of ["issuer_tax_configurations", "draft_lines", "issued_lines", "issued_tax_breakdown",
        "proforma_lines", "proforma_tax_breakdown", "correction_lines", "correction_tax_breakdown"]) {
        const sql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql)
        assert.ok(sql.includes("vat_exemption_reason TEXT"), table)
        assert.ok(sql.includes("RO_NON_VAT"), table)
        assert.ok(sql.endsWith("STRICT"), table)
      }
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
