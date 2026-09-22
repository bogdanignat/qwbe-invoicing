import { Schema } from "effect"

import { nullableString, pageOf } from "./schema-primitives.ts"

const common = {
  id: Schema.String, series: Schema.String, number: Schema.Int, issueDate: Schema.String,
  customer: Schema.Struct({ name: Schema.String }), currency: Schema.String, totalIncludingVat: Schema.String,
}
const EFacturaStatus = Schema.Literal("not_sent", "pending", "sent", "accepted", "rejected")
const InvoiceRegisterInvoice = Schema.Struct({
  kind: Schema.Literal("invoice"), ...common, dueDate: nullableString, eFacturaStatus: EFacturaStatus,
})
const InvoiceRegisterCorrection = Schema.Struct({
  kind: Schema.Literal("correction"), ...common, dueDate: Schema.Null, eFacturaStatus: Schema.Null,
  originalReference: Schema.Struct({ id: Schema.String, series: Schema.String, number: Schema.Int }),
})

export const InvoiceRegisterRow = Schema.Union(InvoiceRegisterInvoice, InvoiceRegisterCorrection).annotations({
  description: "kind discriminates invoice/correction. Correction totals retain their stored negative sign, dueDate/eFacturaStatus are null, and originalReference is present; invoices omit originalReference.",
})
export const InvoiceRegisterPage = pageOf(InvoiceRegisterRow)
