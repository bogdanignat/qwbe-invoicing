import type { DatabaseSync } from "node:sqlite"

import { DomainConflict } from "../cube/invoicing/index.ts"
import type { CatalogTransaction, ProductPreset } from "../cube/invoicing/catalog/index.ts"
import { nameKeyset, read, row, rowsWanted, text, write, type Row } from "./sqlite-rows.ts"

const productPresetFrom = (value: Row): ProductPreset => ({
  id: text(value, "id"),
  organizationId: text(value, "organization_id"),
  description: text(value, "description"),
  unitPrice: text(value, "unit_price"),
  unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
})

// Works on the connection handed in by the store, so preset reads and writes share
// the transaction of the operation that uses them.
export const catalogTransactionAdapter = (database: DatabaseSync): CatalogTransaction => ({
  saveProductPreset: (preset) => write("save product preset", () => {
    const result = database.prepare(`INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description,unit_price=excluded.unit_price,
       unit_code=excluded.unit_code,unit_name=excluded.unit_name
      WHERE product_presets.organization_id=excluded.organization_id`)
      .run(preset.id, preset.organizationId, preset.description, preset.unitPrice,
        preset.unitOfMeasure.code, preset.unitOfMeasure.name)
    if (result.changes === 0) throw new DomainConflict({ code: "product_preset_id_taken", message: "Product preset id belongs to another organization" })
  }),
  findProductPreset: (organizationId, id) => read("find product preset", () => {
    const value = row(database.prepare("SELECT * FROM product_presets WHERE organization_id=? AND id=?").get(organizationId, id))
    return value === undefined ? undefined : productPresetFrom(value)
  }),
  listProductPresets: (organizationId, page) => read("list product presets", () => {
    const keyset = nameKeyset(page, "description")
    return database.prepare(`SELECT * FROM product_presets WHERE organization_id=?${keyset.sql}
      ORDER BY description COLLATE NOCASE,id LIMIT ?`).all(organizationId, ...keyset.values, rowsWanted(page)).map((value) => productPresetFrom(value as Row))
  }),
  deleteProductPreset: (organizationId, id) => write("delete product preset", () => {
    database.prepare("DELETE FROM product_presets WHERE organization_id=? AND id=?").run(organizationId, id)
  }),
})
