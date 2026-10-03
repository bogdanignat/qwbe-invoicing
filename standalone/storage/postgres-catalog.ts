import { DomainConflict } from "../../cube/invoicing/index.ts"
import type { CatalogTransaction, ProductPreset } from "../../cube/invoicing/catalog/index.ts"
import { read, write } from "./postgres-errors.ts"
import { firstRow, optionalText, text, type Row } from "./postgres-rows.ts"
import { assignExcluded, foldedOrder, insertStatement, nameKeyset, pairs, rowsWanted } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

const productPresetFrom = (value: Row): ProductPreset => {
  const preferredVatRateCode = optionalText(value, "preferred_vat_rate_code")
  return {
    id: text(value, "id"),
    organizationId: text(value, "organization_id"),
    description: text(value, "description"),
    unitPrice: text(value, "unit_price"),
    unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
    ...(preferredVatRateCode === undefined ? {} : { preferredVatRateCode }),
  }
}

const presetColumns = [
  "id", "organization_id", "description", "unit_price", "unit_code", "unit_name", "preferred_vat_rate_code",
]

const presetUpdatedColumns = presetColumns.filter((column) =>
  column !== "id" && column !== "organization_id")

// Works on the connection handed in by the store, so preset reads and writes share
// the transaction of the operation that uses them.
export const catalogTransactionAdapter = (client: TransactionClient): CatalogTransaction => ({
  saveProductPreset: (preset) => write("save product preset", async () => {
    const statement = insertStatement("product_presets", pairs(presetColumns, [
      preset.id, preset.organizationId, preset.description, preset.unitPrice,
      preset.unitOfMeasure.code, preset.unitOfMeasure.name, preset.preferredVatRateCode ?? null,
    ]))
    const { rowCount } = await client.query(
      `${statement.sql} ON CONFLICT(id) DO UPDATE SET ${assignExcluded(presetUpdatedColumns)}
        WHERE product_presets.organization_id=excluded.organization_id`,
      statement.values,
    )
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
