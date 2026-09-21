import { array, nullableText, object, type Decoder } from "./model-decoder.ts"
import { decodeCustomer } from "./party-decoders.ts"
import { decodeProductPreset } from "./catalog-decoders.ts"
import { decodeDraft } from "./document-decoders.ts"
import { decodeInvoiceSummary, decodeProformaSummary } from "./commercial-document-decoders.ts"
import { decodeCorrection } from "./ledger-decoders.ts"
import type { Customer } from "./party-models.ts"
import type { ProductPreset } from "./catalog-models.ts"
import type { CorrectionDocument, DraftInvoice, IssuedInvoiceSummary, Page, ProformaSummary } from "./document-models.ts"

export const decodePage = <Item>(decodeItem: Decoder<Item>): Decoder<Page<Item>> => (input) => {
  const value = object(input)
  return {
    items: array(value.items, decodeItem, "items"),
    nextCursor: nullableText(value.nextCursor, "nextCursor"),
  }
}
export const decodeCustomerPage = decodePage<Customer>(decodeCustomer)
export const decodeProductPresetPage = decodePage<ProductPreset>(decodeProductPreset)
export const decodeDraftPage = decodePage<DraftInvoice>(decodeDraft)
export const decodeInvoicePage = decodePage<IssuedInvoiceSummary>(decodeInvoiceSummary)
export const decodeProformaPage = decodePage<ProformaSummary>(decodeProformaSummary)
export const decodeCustomers: Decoder<ReadonlyArray<Customer>> = (input) =>
  array(input, decodeCustomer, "customers")
export const decodeInvoices: Decoder<ReadonlyArray<IssuedInvoiceSummary>> = (input) =>
  array(input, decodeInvoiceSummary, "invoices")
export const decodeDrafts: Decoder<ReadonlyArray<DraftInvoice>> = (input) =>
  array(input, decodeDraft, "drafts")
export const decodeProformas: Decoder<ReadonlyArray<ProformaSummary>> = (input) =>
  array(input, decodeProformaSummary, "proformas")
export const decodeCorrections: Decoder<ReadonlyArray<CorrectionDocument>> = (input) =>
  array(input, decodeCorrection, "corrections")
export const decodeDeleted: Decoder<{ readonly deleted: true }> = (input) => {
  const value = object(input)
  if (value.deleted !== true) throw new Error("invalid deletion response")
  return { deleted: true }
}
