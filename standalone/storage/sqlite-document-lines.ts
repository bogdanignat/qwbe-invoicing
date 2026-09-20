import type { DatabaseSync } from "node:sqlite"

import { validateVatTreatment, type DraftLine, type VatBreakdown } from "../../cube/invoicing/index.ts"
import { nullableText, text, type Row } from "./sqlite-rows.ts"

const storedVatRates = new Map<string, ReadonlySet<string>>([
  ["RO_STANDARD", new Set(["19.00", "21.00"])], ["RO_REDUCED", new Set(["9.00", "11.00"])],
  ["RO_REDUCED_5", new Set(["5.00"])], ["RO_NON_VAT", new Set(["0.00"])],
])

export const vatTreatment = (code: string, rate: string, category: string, reason: string | null) => {
  validateVatTreatment(code, rate, category, reason)
  if (!/^(?:0|[1-9]\d{0,2})\.\d{2}$/.test(rate) || storedVatRates.get(code)?.has(rate) !== true) {
    throw new Error(`invalid stored VAT pair ${code}/${rate}`)
  }
  return { vatCategoryCode: category as DraftLine["vatCategoryCode"], vatExemptionReason: reason }
}

export const vatTreatmentFrom = (value: Row, codeField: string, rateField: string, categoryField: string) => {
  const code = text(value, codeField)
  const rate = text(value, rateField)
  return { code, rate, ...vatTreatment(code, rate, text(value, categoryField), nullableText(value, "vat_exemption_reason")) }
}

export const lineFrom = (value: Row): DraftLine => {
  const treatment = vatTreatmentFrom(value, "tax_code", "tax_rate", "tax_category")
  return {
    id: text(value, "id"), description: text(value, "description"), quantity: text(value, "quantity"),
    unitPrice: text(value, "unit_price"), unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
    vatRateCode: treatment.code, vatRate: treatment.rate, vatCategoryCode: treatment.vatCategoryCode,
    vatExemptionReason: treatment.vatExemptionReason, totalExcludingVat: text(value, "total_excluding_tax"),
    vatAmount: text(value, "tax_amount"), totalIncludingVat: text(value, "total_including_tax"),
  }
}

type LineTable = "draft_lines" | "issued_lines" | "proforma_lines"
type LineTarget = { readonly table: "draft_lines" | "issued_lines" }
  | { readonly table: "proforma_lines"; readonly organizationId: string }
const lineParent = (table: LineTable) => table === "draft_lines" ? "draft_id" : table === "issued_lines" ? "invoice_id" : "proforma_id"

export const saveLines = (database: DatabaseSync, target: LineTarget, parentId: string, lines: ReadonlyArray<DraftLine>) => {
  const { table } = target
  const parentColumn = lineParent(table)
  const scoped = table === "proforma_lines"
  const idColumns = `id, ${parentColumn}${scoped ? ", organization_id" : ""}`
  database.prepare(`DELETE FROM ${table} WHERE ${parentColumn} = ?`).run(parentId)
  const statement = database.prepare(`INSERT INTO ${table}
    (${idColumns}, line_position, description, quantity, unit_price, unit_code, unit_name, tax_code, tax_category,
      tax_rate, vat_exemption_reason, total_excluding_tax, tax_amount, total_including_tax)
    VALUES (?, ?, ${scoped ? "?, " : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  lines.forEach((line, position) => {
    vatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
    statement.run(line.id, parentId, ...(target.table === "proforma_lines" ? [target.organizationId] : []), position,
      line.description, line.quantity, line.unitPrice, line.unitOfMeasure.code, line.unitOfMeasure.name,
      line.vatRateCode, line.vatCategoryCode, line.vatRate, line.vatExemptionReason, line.totalExcludingVat,
      line.vatAmount, line.totalIncludingVat)
  })
}

export const loadLines = (database: DatabaseSync, table: LineTable, parentId: string): ReadonlyArray<DraftLine> => {
  const parentColumn = lineParent(table)
  return database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY line_position`).all(parentId)
    .map((value) => lineFrom(value as Row))
}

export const taxBreakdownFrom = (database: DatabaseSync, table: "issued_tax_breakdown" | "proforma_tax_breakdown", parentColumn: "invoice_id" | "proforma_id", id: string): ReadonlyArray<VatBreakdown> =>
  database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY line_position`).all(id).map((item) => {
    const tax = item as Row
    const treatment = vatTreatmentFrom(tax, "tax_code", "rate", "category")
    return { code: treatment.code, rate: treatment.rate, vatCategoryCode: treatment.vatCategoryCode,
      vatExemptionReason: treatment.vatExemptionReason, vatBaseAmount: text(tax, "taxable_amount"), vatAmount: text(tax, "tax_amount") }
  })
