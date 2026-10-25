import { compareDecimal, isCanonicalDecimal } from "../../cubes/invoicing/contracts/money.ts"
import type { EFacturaDocument } from "../../cubes/invoicing/efactura/index.ts"
import { EFacturaContractViolation, validateEFacturaDocument } from "../../cubes/invoicing/efactura/index.ts"
import type { CorrectionDocument, DraftLine, IssuedInvoice, VatBreakdown } from "../../cubes/invoicing/index.ts"
import { validateFiscalDocument } from "../../cubes/invoicing/index.ts"
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

/** The sign is read and dropped on the text; a form the snapshot never holds is refused before anything reads its value. */
const unnegate = (value: string, field: string, issues: Array<string>): string => {
  const magnitude = value.startsWith("-") ? value.slice(1) : value
  // Canonical at the scale the text carries, so "-02.0000" is never read as "-2.0000".
  const canonical = !magnitude.startsWith("-") && isCanonicalDecimal(magnitude, magnitude.split(".")[1]?.length ?? 0)
  if (!canonical) issues.push(`${field} is not a canonical decimal, got "${value}"`)
  else if (magnitude === value && compareDecimal(value, "0") !== 0) {
    issues.push(`${field} is expected to be negative on a correction, got "${value}"`)
  }
  return magnitude
}

const creditLine = (line: DraftLine, index: number, issues: Array<string>): DraftLine => {
  const where = `lines[${String(index)}]`
  return {
    ...line,
    quantity: unnegate(line.quantity, `${where}.quantity`, issues),
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
  document.lines.map(({ description, itemCode, barcode, quantity, unitPrice, unitOfMeasure, vatRateCode, vatRate,
    vatCategoryCode, vatExemptionReason, totalExcludingVat, vatAmount, totalIncludingVat }) => [description,
    itemCode ?? null, barcode ?? null, quantity, unitPrice, unitOfMeasure.code, unitOfMeasure.name, vatRateCode, vatRate,
    vatCategoryCode, vatExemptionReason, totalExcludingVat, vatAmount, totalIncludingVat]),
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
