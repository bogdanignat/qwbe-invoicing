import { parseStrictXml, type XmlLimits } from "../../submissions/index.ts"
import type { ReceivedDocument, ReceivedKind, ReceivedRead } from "./document.ts"
import { defined, optionalCurrency, optionalDate, optionalText, requiredCurrency, requiredDate, requiredText, texts } from "./fields.ts"
import { readAllowanceCharge } from "./charges.ts"
import { readLines } from "./lines.ts"
import { readParty } from "./parties.ts"
import { readTotals, readVat } from "./taxes.ts"
import { receivedWarnings } from "./warnings.ts"
import { CREDIT_NOTE_NS, INVOICE_NS, UblRefused, all, required, resolveNamespaces, type UblNode } from "./xml-tree.ts"

/**
 * Reads the UBL XML of a received invoice or credit note, written by any
 * program: comments are skipped and CDATA is text, a DOCTYPE or an entity is
 * refused, and elements are found by namespace URI, never by prefix. The result
 * is the normalized document with its warnings, or why it could not be read.
 * `expectedBuyerCif` is the CIF of the organization the invoice was fetched for.
 */
/**
 * Measured once on synthetic invoices (T-2025): 5 MB, 3 500 lines, about 106 000
 * elements, read in about 0.25 s, the event loop held as long; 10 MB of realistic
 * lines is about 210 000 elements (0.4 s); 10 MB of the shortest UBL elements
 * about 470 000 (0.5 s). `maxChars` is the ZIP's 10 MB per file (a character is
 * at least one UTF-8 byte). `maxElements` sits just above the realistic 10 MB
 * invoice, so a flood of empty tags stops well before the character limit
 * (`limits.test.ts`). UBL nests about 8 deep and declares a handful of namespaces.
 */
export const RECEIVED_XML_LIMITS: XmlLimits = { maxChars: 10 * 1024 * 1024, maxDepth: 32, maxElements: 250_000, maxAttributes: 64 }

const ROOTS: ReadonlyArray<{ readonly namespace: string; readonly local: string; readonly kind: ReceivedKind; readonly typeCode: string }> = [
  { namespace: INVOICE_NS, local: "Invoice", kind: "invoice", typeCode: "cbc:InvoiceTypeCode" },
  { namespace: CREDIT_NOTE_NS, local: "CreditNote", kind: "credit_note", typeCode: "cbc:CreditNoteTypeCode" },
]

/** `DueDate`, else the payment due date every `PaymentMeans` agrees on. */
const dueDate = (root: UblNode): string | undefined => {
  const due = optionalDate(root, "cbc:DueDate")
  if (due !== undefined) return due
  const means = new Set(all(root, "cac:PaymentMeans").map((node) => optionalDate(node, "cbc:PaymentDueDate")))
  return means.size === 1 ? [...means][0] : undefined
}

const readDocument = (root: UblNode): ReceivedDocument | undefined => {
  const shape = ROOTS.find(({ namespace, local }) => root.namespace === namespace && root.local === local)
  if (shape === undefined) return undefined
  const currency = requiredCurrency(root, "cbc:DocumentCurrencyCode")
  const taxCurrency = optionalCurrency(root, "cbc:TaxCurrencyCode")
  return defined({
    kind: shape.kind,
    typeCode: optionalText(root, shape.typeCode),
    number: requiredText(root, "cbc:ID"),
    issueDate: requiredDate(root, "cbc:IssueDate"),
    dueDate: dueDate(root),
    currency,
    taxCurrency,
    notes: texts(root, "cbc:Note"),
    supplier: readParty(required(root, "cac:AccountingSupplierParty/cac:Party")),
    buyer: readParty(required(root, "cac:AccountingCustomerParty/cac:Party")),
    paymentAccounts: texts(root, "cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"),
    billingReferences: all(root, "cac:BillingReference/cac:InvoiceDocumentReference").map((reference) => defined({
      number: requiredText(reference, "cbc:ID"),
      issueDate: optionalDate(reference, "cbc:IssueDate"),
    })),
    orderReference: optionalText(root, "cac:OrderReference/cbc:ID"),
    contractReferences: texts(root, "cac:ContractDocumentReference/cbc:ID"),
    allowanceCharges: all(root, "cac:AllowanceCharge").map(readAllowanceCharge),
    totals: readTotals(root),
    vat: readVat(root, currency, taxCurrency),
    lines: readLines(root, shape.kind),
  })
}

export const readReceivedUbl = (xml: string, expectedBuyerCif: string): ReceivedRead => {
  const parsed = parseStrictXml(xml, RECEIVED_XML_LIMITS, { commentsAndCdata: true })
  if (!parsed.ok) return { ok: false, failure: { reason: "xml", refusal: parsed.refusal } }
  try {
    const document = readDocument(resolveNamespaces(parsed.root))
    if (document === undefined) return { ok: false, failure: { reason: "not_ubl" } }
    return { ok: true, document, warnings: receivedWarnings(document, expectedBuyerCif) }
  } catch (error) {
    if (error instanceof UblRefused) return { ok: false, failure: error.failure }
    throw error
  }
}
