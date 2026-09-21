import type { EFacturaDocument } from "../../cube/efactura/index.ts"
import { validateEFacturaDocument } from "../../cube/efactura/index.ts"
import type { IssuedInvoice } from "../../cube/invoicing/index.ts"
import {
  buyer,
  documentNotes,
  documentNumber,
  legalReference,
  mapLine,
  mapSubtotal,
  notSubjectToVat,
  seller,
} from "./efactura-mapper-shared.ts"

export const mapIssuedInvoice = (invoice: IssuedInvoice): EFacturaDocument => {
  const document: EFacturaDocument = {
    kind: "invoice",
    id: documentNumber(invoice),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currencyCode: invoice.currency,
    notes: documentNotes(legalReference(invoice.vatBreakdown), invoice.notes),
    precedingInvoice: null,
    seller: seller(invoice.issuer),
    buyer: buyer(invoice.customer, notSubjectToVat(invoice.lines)),
    lines: invoice.lines.map(mapLine),
    taxSubtotals: invoice.vatBreakdown.map(mapSubtotal),
    lineExtensionAmount: invoice.totalExcludingVat,
    taxExclusiveAmount: invoice.totalExcludingVat,
    taxAmount: invoice.vatTotal,
    taxInclusiveAmount: invoice.totalIncludingVat,
    payableAmount: invoice.totalIncludingVat,
  }
  validateEFacturaDocument(document)
  return document
}
