import type { EFacturaDocument } from "../../cube/efactura/index.ts"
import { EFacturaContractViolation, validateEFacturaDocument } from "../../cube/efactura/index.ts"
import type { CorrectionDocument, DraftLine, IssuedInvoice, VatBreakdown } from "../../cube/invoicing/index.ts"
import { validateFiscalDocument } from "../../cube/invoicing/index.ts"
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

const unnegate = (value: string, field: string, issues: Array<string>): string => {
  if (value.startsWith("-")) return value.slice(1)
  if (/^0+(?:\.0+)?$/.test(value)) return value
  issues.push(`${field} is expected to be negative on a correction, got "${value}"`)
  return value
}

const creditLine = (line: DraftLine, index: number, issues: Array<string>): DraftLine => {
  const where = `lines[${String(index)}]`
  return {
    ...line,
    totalExcludingVat: unnegate(line.totalExcludingVat, `${where}.totalExcludingVat`, issues),
    vatAmount: unnegate(line.vatAmount, `${where}.vatAmount`, issues),
    totalIncludingVat: unnegate(line.totalIncludingVat, `${where}.totalIncludingVat`, issues),
  }
}

const fiscalFingerprint = (document: {
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}): string => JSON.stringify([
  document.lines.map(({ description, quantity, unitPrice, unitOfMeasure, vatRateCode, vatRate, vatCategoryCode,
    vatExemptionReason, totalExcludingVat, vatAmount, totalIncludingVat }) => [description, quantity, unitPrice,
    unitOfMeasure.code, unitOfMeasure.name, vatRateCode, vatRate, vatCategoryCode, vatExemptionReason,
    totalExcludingVat, vatAmount, totalIncludingVat]),
  document.vatBreakdown.map(({ code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount }) =>
    [code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount]).toSorted(),
  document.totalExcludingVat, document.vatTotal, document.totalIncludingVat,
])

export const mapCorrection = (correction: CorrectionDocument, original: IssuedInvoice): EFacturaDocument => {
  const issues: Array<string> = []
  if (correction.originalInvoiceId !== original.id) issues.push("the supplied original invoice is not the one this correction reverses")
  if (correction.organizationId !== original.organizationId) {
    issues.push("the correction and its original invoice belong to different organizations")
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })
  const lines = correction.lines.map((line, index) => creditLine(line, index, issues))
  const vatBreakdown = correction.vatBreakdown.map((breakdown, index) => ({
    ...breakdown,
    vatBaseAmount: unnegate(breakdown.vatBaseAmount, `vatBreakdown[${String(index)}].vatBaseAmount`, issues),
    vatAmount: unnegate(breakdown.vatAmount, `vatBreakdown[${String(index)}].vatAmount`, issues),
  }))
  const credit = {
    lines,
    vatBreakdown,
    totalExcludingVat: unnegate(correction.totalExcludingVat, "totalExcludingVat", issues),
    vatTotal: unnegate(correction.vatTotal, "vatTotal", issues),
    totalIncludingVat: unnegate(correction.totalIncludingVat, "totalIncludingVat", issues),
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })
  for (const [label, document] of [["the original invoice", original], ["the credit note", credit]] as const) {
    try { validateFiscalDocument(document) }
    catch { issues.push(`${label} does not recalculate consistently`) }
  }
  if (issues.length === 0 && fiscalFingerprint(credit) !== fiscalFingerprint(original)) {
    issues.push("the credit note does not reverse the original invoice exactly")
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })
  const document: EFacturaDocument = {
    kind: "credit_note",
    id: documentNumber(correction),
    issueDate: correction.issueDate,
    dueDate: null,
    currencyCode: correction.currency,
    notes: documentNotes(legalReference(vatBreakdown), correction.reason),
    precedingInvoice: { id: documentNumber(original), issueDate: original.issueDate },
    seller: seller(correction.issuer),
    buyer: buyer(correction.customer, notSubjectToVat(lines)),
    lines: lines.map(mapLine),
    taxSubtotals: vatBreakdown.map(mapSubtotal),
    lineExtensionAmount: credit.totalExcludingVat,
    taxExclusiveAmount: credit.totalExcludingVat,
    taxAmount: credit.vatTotal,
    taxInclusiveAmount: credit.totalIncludingVat,
    payableAmount: credit.totalIncludingVat,
  }
  validateEFacturaDocument(document)
  return document
}
