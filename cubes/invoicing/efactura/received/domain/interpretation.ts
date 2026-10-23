import { formatDecimal, parseDecimal } from "../../../contracts/money.ts"
import {
  UblRefused, computable, readReceivedUbl, refuseField, type Amount, type ReadFailure, type ReceivedDocument, type ReceivedKind, type ReceivedWarning,
} from "../../received-ubl/index.ts"

/** What the list of received invoices shows, in the document's own currency; money as 2-decimal strings. */
export interface ReceivedListing {
  readonly kind: ReceivedKind
  readonly number: string
  readonly issueDate: string
  readonly currency: string
  readonly supplierName: string
  /** The supplier's VAT code, else its CIF without VAT, as the XML writes it. */
  readonly supplierCif: string
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly payable: string
}

export type UnreadableReason =
  | { readonly source: "zip"; readonly refusal: string }
  | { readonly source: "encoding" }
  | { readonly source: "ubl"; readonly failure: ReadFailure }

/**
 * What was read out of one archive: the invoice with its list columns, the
 * whole normalized document and its warnings; or why it could not be read.
 * It is replaced, never amended, when the archive is read again.
 */
export type Interpretation =
  | {
    readonly readable: true
    readonly listing: ReceivedListing
    readonly document: ReceivedDocument
    readonly warnings: ReadonlyArray<ReceivedWarning>
  }
  | { readonly readable: false; readonly reason: UnreadableReason }

/** The ZIP as the host opened it: the invoice XML's bytes, or why the ZIP was refused. */
export type OpenedArchive = { readonly ok: true; readonly invoice: Uint8Array } | { readonly ok: false; readonly refusal: string }

const PATHS = {
  supplierName: "cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName",
  supplierCif: "cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID",
  taxExclusive: "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount",
  tax: "cac:TaxTotal/cbc:TaxAmount",
  payable: "cac:LegalMonetaryTotal/cbc:PayableAmount",
} as const

/** The stored list totals are BIGINT bani. */
const MAX_UNITS = 2n ** 63n - 1n

/**
 * A list total: in the document's currency and exactly at 2 decimals, which is
 * all CIUS-RO allows on totals (BR-DEC). Anything else is not rounded or
 * guessed: the invoice is unreadable for the list, and its archive stays.
 */
const money = (amount: Amount | undefined, currency: string, path: string): string => {
  if (amount === undefined) return refuseField("missing", path)
  const parsed = parseDecimal(computable(amount.value), 2)
  if (!parsed.ok || amount.currency !== currency || parsed.units > MAX_UNITS || parsed.units < -MAX_UNITS) return refuseField("invalid", path)
  return formatDecimal(parsed.units, 2)
}

const listingOf = (document: ReceivedDocument): ReceivedListing => {
  const { currency, supplier, totals, vat } = document
  return {
    kind: document.kind, number: document.number, issueDate: document.issueDate, currency,
    supplierName: supplier.name ?? refuseField("missing", PATHS.supplierName),
    supplierCif: supplier.vatId ?? supplier.taxRegistrationId ?? refuseField("missing", PATHS.supplierCif),
    totalExcludingTax: money(totals.taxExclusive, currency, PATHS.taxExclusive),
    taxTotal: money(vat.total, currency, PATHS.tax),
    payable: money(totals.payable, currency, PATHS.payable),
  }
}

const decode = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Reads the archive's invoice for the organization whose CIF is `expectedBuyerCif`. */
export const interpretArchive = (archive: OpenedArchive, expectedBuyerCif: string): Interpretation => {
  if (!archive.ok) return { readable: false, reason: { source: "zip", refusal: archive.refusal } }
  const xml = decode(archive.invoice)
  if (xml === undefined) return { readable: false, reason: { source: "encoding" } }
  const read = readReceivedUbl(xml, expectedBuyerCif)
  if (!read.ok) return { readable: false, reason: { source: "ubl", failure: read.failure } }
  try {
    return { readable: true, listing: listingOf(read.document), document: read.document, warnings: read.warnings }
  } catch (error) {
    if (error instanceof UblRefused) return { readable: false, reason: { source: "ubl", failure: error.failure } }
    throw error
  }
}
