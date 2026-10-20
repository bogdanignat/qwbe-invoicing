import { Schema } from "effect"

import { E_FACTURA_STATUSES } from "../../cubes/invoicing/index.ts"
import { nullableString, pageOf } from "./schema-primitives.ts"

const common = {
  id: Schema.String, series: Schema.String, number: Schema.Int, issueDate: Schema.String,
  customer: Schema.Struct({ name: Schema.String }), currency: Schema.String, totalIncludingVat: Schema.String,
}
export const EFacturaStatus = Schema.Literal(...E_FACTURA_STATUSES)
const InvoiceRegisterInvoice = Schema.Struct({
  kind: Schema.Literal("invoice"), ...common, dueDate: nullableString, eFacturaStatus: Schema.NullOr(EFacturaStatus),
})
const InvoiceRegisterCorrection = Schema.Struct({
  kind: Schema.Literal("correction"), ...common, dueDate: Schema.Null, eFacturaStatus: Schema.NullOr(EFacturaStatus),
  originalReference: Schema.Struct({ id: Schema.String, series: Schema.String, number: Schema.Int }),
})

export const InvoiceRegisterRow = Schema.Union(InvoiceRegisterInvoice, InvoiceRegisterCorrection).annotations({
  description: "kind discriminates invoice/correction. Correction totals retain their stored negative sign, dueDate is null, and originalReference is present; invoices omit originalReference. eFacturaStatus (invoice and correction alike) is null when the e-Factura plugin is off.",
})
export const InvoiceRegisterPage = pageOf(InvoiceRegisterRow)
