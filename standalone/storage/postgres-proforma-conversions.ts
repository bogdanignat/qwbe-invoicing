import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import { read, write } from "./postgres-errors.ts"
import { firstRow, text } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type ConversionsTransaction = Pick<ProformaTransaction,
  "findProformaConversion" | "saveProformaConversion" | "findProformaInvoiceConversion" | "saveProformaInvoiceConversion">

/**
 * The two conversion ledgers. Their unique keys are what makes a second
 * conversion impossible, and the operation names here are the ones
 * `writeFailure` recognises: a constraint violation on either becomes
 * `proforma_already_converted`, not a generic write conflict.
 */
export const proformaConversionsTransactionAdapter = (client: TransactionClient): ConversionsTransaction => ({
  findProformaConversion: (organizationId, proformaId) => read("find proforma conversion", async () => {
    const { rows } = await client.query(
      "SELECT * FROM proforma_conversions WHERE organization_id=$1 AND proforma_id=$2", [organizationId, proformaId],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : {
      proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
      resultingDraftId: text(value, "resulting_draft_id"), actorId: text(value, "actor_id"),
      convertedAt: text(value, "converted_at"),
    }
  }),
  saveProformaConversion: (conversion) => write("save proforma conversion", async () => {
    await client.query(
      `INSERT INTO proforma_conversions(proforma_id,organization_id,resulting_draft_id,actor_id,converted_at)
        VALUES($1,$2,$3,$4,$5)`,
      [conversion.proformaId, conversion.organizationId, conversion.resultingDraftId,
        conversion.actorId, conversion.convertedAt],
    )
  }),
  findProformaInvoiceConversion: (organizationId, proformaId) =>
    read("find proforma invoice conversion", async () => {
      const { rows } = await client.query(
        "SELECT * FROM proforma_invoice_conversions WHERE organization_id=$1 AND proforma_id=$2",
        [organizationId, proformaId],
      )
      const value = firstRow(rows)
      return value === undefined ? undefined : {
        proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
        resultingInvoiceId: text(value, "resulting_invoice_id"), actorId: text(value, "actor_id"),
        convertedAt: text(value, "converted_at"),
      }
    }),
  saveProformaInvoiceConversion: (conversion) => write("save proforma invoice conversion", async () => {
    await client.query(
      `INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,converted_at)
        VALUES($1,$2,$3,$4,$5)`,
      [conversion.proformaId, conversion.organizationId, conversion.resultingInvoiceId,
        conversion.actorId, conversion.convertedAt],
    )
  }),
})
