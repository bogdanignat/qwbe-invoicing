import { DomainConflict } from "../../cubes/invoicing/index.ts"
import { codeTakenConflict, productKinds, type CatalogTransaction, type ProductKind, type ProductPreset } from "../../cubes/invoicing/catalog/index.ts"
import { read, sqlState, write } from "./postgres-errors.ts"
import { money, moneyValue } from "./postgres-money.ts"
import { firstRow, optionalText, text, type Row } from "./postgres-rows.ts"
import { assignExcluded, foldedOrder, insertStatement, nameKeyset, pairs, rowsWanted } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

const kindFrom = (value: Row): ProductKind => {
  const kind = text(value, "kind")
  if (!productKinds.includes(kind as ProductKind)) throw new Error(`invalid stored product kind ${kind}`)
  return kind as ProductKind
}

const productPresetFrom = (value: Row): ProductPreset => {
  const preferredVatRateCode = optionalText(value, "preferred_vat_rate_code")
  const barcode = optionalText(value, "barcode")
  return {
    id: text(value, "id"),
    organizationId: text(value, "organization_id"),
    code: text(value, "code"),
    kind: kindFrom(value),
    description: text(value, "description"),
    unitPrice: money(value, "unit_price"),
    unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
    ...(preferredVatRateCode === undefined ? {} : { preferredVatRateCode }),
    ...(barcode === undefined ? {} : { barcode }),
  }
}

const presetColumns = [
  "id", "organization_id", "code", "kind", "description", "unit_price", "unit_code", "unit_name", "preferred_vat_rate_code", "barcode",
]

// The unique index on (organization_id, lower(code)) is the only judge of a taken code: a SELECT
// first would race. Its violation, and nothing else, becomes the conflict a person can act on.
const codeIndex = "product_presets_code"
const isCodeTaken = (error: unknown): boolean => sqlState(error) === "23505"
  && typeof error === "object" && error !== null && (error as { readonly constraint?: unknown }).constraint === codeIndex

const presetUpdatedColumns = presetColumns.filter((column) =>
  column !== "id" && column !== "organization_id")

// Works on the connection handed in by the store, so preset reads and writes share
// the transaction of the operation that uses them.
export const catalogTransactionAdapter = (client: TransactionClient): CatalogTransaction => ({
  saveProductPreset: (preset) => write("save product preset", async () => {
    const statement = insertStatement("product_presets", pairs(presetColumns, [
      preset.id, preset.organizationId, preset.code, preset.kind, preset.description, moneyValue(preset.unitPrice),
      preset.unitOfMeasure.code, preset.unitOfMeasure.name, preset.preferredVatRateCode ?? null, preset.barcode ?? null,
    ]))
    const { rowCount } = await client.query(
      `${statement.sql} ON CONFLICT(id) DO UPDATE SET ${assignExcluded(presetUpdatedColumns)}
        WHERE product_presets.organization_id=excluded.organization_id`,
      statement.values,
    ).catch((error: unknown) => {
      throw isCodeTaken(error) ? codeTakenConflict(preset.code) : error
    })
    if (rowCount === 0) {
      throw new DomainConflict({
        code: "product_preset_id_taken", message: "Product preset id belongs to another organization",
      })
    }
  }),
  findProductPreset: (organizationId, id) => read("find product preset", async () => {
    const { rows } = await client.query(
      "SELECT * FROM product_presets WHERE organization_id=$1 AND id=$2", [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : productPresetFrom(value)
  }),
  listProductPresets: (organizationId, page) => read("list product presets", async () => {
    // The ORDER BY expression is the one `product_presets_organization` indexes.
    const keyset = nameKeyset(page, "description", 2)
    const { rows } = await client.query(
      `SELECT * FROM product_presets WHERE organization_id=$1${keyset.sql}
        ORDER BY ${foldedOrder("description")} LIMIT $${String(2 + keyset.values.length)}`,
      [organizationId, ...keyset.values, rowsWanted(page)],
    )
    return rows.map(productPresetFrom)
  }),
  deleteProductPreset: (organizationId, id) => write("delete product preset", async () => {
    await client.query("DELETE FROM product_presets WHERE organization_id=$1 AND id=$2", [organizationId, id])
  }),
})
