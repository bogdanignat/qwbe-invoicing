import type { DatabaseSync } from "node:sqlite"

import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import { read, row, text, write } from "./sqlite-rows.ts"

type ConversionsTransaction = Pick<ProformaTransaction,
  "findProformaConversion" | "saveProformaConversion" | "findProformaInvoiceConversion" | "saveProformaInvoiceConversion">

export const proformaConversionsTransactionAdapter = (database: DatabaseSync): ConversionsTransaction => ({
  findProformaConversion: (organizationId, proformaId) => read("find proforma conversion", () => {
    const value = row(database.prepare("SELECT * FROM proforma_conversions WHERE organization_id=? AND proforma_id=?")
      .get(organizationId, proformaId))
    return value === undefined ? undefined : {
      proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
      resultingDraftId: text(value, "resulting_draft_id"), actorId: text(value, "actor_id"),
      convertedAt: text(value, "converted_at"),
    }
  }),
  saveProformaConversion: (conversion) => write("save proforma conversion", () => {
    database.prepare(`INSERT INTO proforma_conversions(proforma_id,organization_id,resulting_draft_id,actor_id,converted_at)
      VALUES(?,?,?,?,?)`).run(conversion.proformaId, conversion.organizationId, conversion.resultingDraftId,
      conversion.actorId, conversion.convertedAt)
  }),
  findProformaInvoiceConversion: (organizationId, proformaId) => read("find proforma invoice conversion", () => {
    const value = row(database.prepare("SELECT * FROM proforma_invoice_conversions WHERE organization_id=? AND proforma_id=?")
      .get(organizationId, proformaId))
    return value === undefined ? undefined : { proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
      resultingInvoiceId: text(value, "resulting_invoice_id"), actorId: text(value, "actor_id"), convertedAt: text(value, "converted_at") }
  }),
  saveProformaInvoiceConversion: (conversion) => write("save proforma invoice conversion", () => {
    database.prepare(`INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,converted_at)
      VALUES(?,?,?,?,?)`).run(conversion.proformaId, conversion.organizationId, conversion.resultingInvoiceId,
      conversion.actorId, conversion.convertedAt)
  }),
})
