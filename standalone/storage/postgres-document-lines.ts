import { validateVatTreatment, type DraftLine, type VatBreakdown } from "../../cube/invoicing/index.ts"
import { nullableText, text, type Row } from "./postgres-rows.ts"
import { insertStatement, pairs, type QueryValue } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * Document lines and the tax breakdown, on the connection of the open
 * transaction. The VAT pair is validated in the adapter as well as by the
 * table's CHECK, because a stored pair that no longer matches the matrix is a
 * read-time defect the decoder has to refuse.
 */

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
export type LineTarget = { readonly table: "draft_lines" | "issued_lines" }
  | { readonly table: "proforma_lines"; readonly organizationId: string }

const lineParent = (table: LineTable) =>
  table === "draft_lines" ? "draft_id" : table === "issued_lines" ? "invoice_id" : "proforma_id"

export const lineColumns = [
  "line_position", "description", "quantity", "unit_price", "unit_code", "unit_name",
  "tax_code", "tax_category", "tax_rate", "vat_exemption_reason",
  "total_excluding_tax", "tax_amount", "total_including_tax",
] as const

export const lineValues = (position: number, line: DraftLine): ReadonlyArray<QueryValue> => [
  position, line.description, line.quantity, line.unitPrice, line.unitOfMeasure.code, line.unitOfMeasure.name,
  line.vatRateCode, line.vatCategoryCode, line.vatRate, line.vatExemptionReason,
  line.totalExcludingVat, line.vatAmount, line.totalIncludingVat,
]

export const saveLines = async (
  client: TransactionClient,
  target: LineTarget,
  parentId: string,
  lines: ReadonlyArray<DraftLine>,
): Promise<void> => {
  const { table } = target
  const parentColumn = lineParent(table)
  await client.query(`DELETE FROM ${table} WHERE ${parentColumn} = $1`, [parentId])
  const scope = target.table === "proforma_lines"
    ? { columns: ["organization_id"], values: [target.organizationId] }
    : { columns: [], values: [] }
  for (const [position, line] of lines.entries()) {
    vatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
    const statement = insertStatement(table, pairs(
      ["id", parentColumn, ...scope.columns, ...lineColumns],
      [line.id, parentId, ...scope.values, ...lineValues(position, line)],
    ))
    await client.query(statement.sql, statement.values)
  }
}

export const loadLines = async (
  client: TransactionClient,
  table: LineTable,
  parentId: string,
): Promise<ReadonlyArray<DraftLine>> => {
  const parentColumn = lineParent(table)
  const { rows } = await client.query(
    `SELECT * FROM ${table} WHERE ${parentColumn} = $1 ORDER BY line_position`, [parentId],
  )
  return rows.map(lineFrom)
}

export const breakdownColumns = [
  "line_position", "tax_code", "category", "rate", "vat_exemption_reason", "taxable_amount", "tax_amount",
] as const

export const breakdownValues = (position: number, tax: VatBreakdown): ReadonlyArray<QueryValue> => [
  position, tax.code, tax.vatCategoryCode, tax.rate, tax.vatExemptionReason, tax.vatBaseAmount, tax.vatAmount,
]

export const breakdownFrom = (value: Row): VatBreakdown => {
  const treatment = vatTreatmentFrom(value, "tax_code", "rate", "category")
  return {
    code: treatment.code, rate: treatment.rate, vatCategoryCode: treatment.vatCategoryCode,
    vatExemptionReason: treatment.vatExemptionReason,
    vatBaseAmount: text(value, "taxable_amount"), vatAmount: text(value, "tax_amount"),
  }
}

export const taxBreakdownFrom = async (
  client: TransactionClient,
  table: "issued_tax_breakdown" | "proforma_tax_breakdown",
  parentColumn: "invoice_id" | "proforma_id",
  id: string,
): Promise<ReadonlyArray<VatBreakdown>> => {
  const { rows } = await client.query(
    `SELECT * FROM ${table} WHERE ${parentColumn} = $1 ORDER BY line_position`, [id],
  )
  return rows.map(breakdownFrom)
}
