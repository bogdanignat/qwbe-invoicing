import {
  array, boolean, integer, nullableText, object, optionalInteger, optionalText, text,
  type Decoder, type JsonObject,
} from "./model-decoder.ts"
import { decodeEFacturaStatus } from "./invoice-register.ts"
import type {
  Address, BuyerSnapshot, CorrectionDocument, DocumentLine, IssuedInvoice, IssuerSnapshot,
  UnitOfMeasure, VatBreakdownEntry,
} from "./document-snapshot.ts"

/**
 * Structural decoding only, on purpose.
 *
 * The authoring side of the legacy client re-derives fiscal invariants while
 * decoding — canonical CUI, county and sector agreement, the VAT rate/category/
 * exemption triple — because it also builds documents and must refuse to send
 * an inconsistent one. These screens only read documents the backend already
 * sealed and will never write back, so repeating those checks here would make a
 * read fail over a rule the server is the authority for. What is asserted is
 * that every field the screen renders is present and of the declared type, so a
 * contract change surfaces at the boundary rather than as a blank cell.
 */
const decodeAddress: Decoder<Address> = (input) => {
  const value = object(input)
  const sector = optionalInteger(value.sector, "sector")
  const postalCode = optionalText(value.postalCode, "postalCode")
  return {
    countryCode: text(value.countryCode, "countryCode"),
    city: text(value.city, "city"),
    street: text(value.street, "street"),
    county: text(value.county, "county"),
    ...(sector === undefined ? {} : { sector }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}

const decodeParty = (value: JsonObject) => ({
  name: text(value.name, "name"),
  fiscalIdentifier: text(value.fiscalIdentifier, "fiscalIdentifier"),
  address: decodeAddress(value.address),
})

const decodeIssuer: Decoder<IssuerSnapshot> = (input) => {
  const value = object(input)
  return {
    ...decodeParty(value),
    legalForm: text(value.legalForm, "legalForm"),
    tradeRegistryNumber: text(value.tradeRegistryNumber, "tradeRegistryNumber"),
    iban: text(value.iban, "iban"),
    bankName: text(value.bankName, "bankName"),
    socialCapital: text(value.socialCapital, "socialCapital"),
    vatRegistered: boolean(value.vatRegistered, "vatRegistered"),
  }
}

const decodeBuyer: Decoder<BuyerSnapshot> = (input) => {
  const value = object(input)
  const partyType = text(value.partyType, "partyType")
  if (partyType !== "company" && partyType !== "individual") throw new Error("invalid partyType")
  return {
    ...decodeParty(value),
    partyType,
    vatRegistered: boolean(value.vatRegistered, "vatRegistered"),
  }
}

const decodeUnitOfMeasure: Decoder<UnitOfMeasure> = (input) => {
  const value = object(input)
  return { code: text(value.code, "unitOfMeasure.code"), name: text(value.name, "unitOfMeasure.name") }
}

const decodeLine: Decoder<DocumentLine> = (input) => {
  const value = object(input)
  return {
    id: text(value.id, "line.id"),
    description: text(value.description, "description"),
    quantity: text(value.quantity, "quantity"),
    unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    vatRateCode: text(value.vatRateCode, "vatRateCode"),
    vatRate: text(value.vatRate, "vatRate"),
    vatCategoryCode: text(value.vatCategoryCode, "vatCategoryCode"),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatAmount: text(value.vatAmount, "vatAmount"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

const decodeVatBreakdownEntry: Decoder<VatBreakdownEntry> = (input) => {
  const value = object(input)
  return {
    code: text(value.code, "vatBreakdown.code"),
    rate: text(value.rate, "vatBreakdown.rate"),
    vatCategoryCode: text(value.vatCategoryCode, "vatBreakdown.vatCategoryCode"),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatBreakdown.vatExemptionReason"),
    vatBaseAmount: text(value.vatBaseAmount, "vatBaseAmount"),
    vatAmount: text(value.vatAmount, "vatBreakdown.vatAmount"),
  }
}

const decodeBody = (value: JsonObject) => ({
  issuer: decodeIssuer(value.issuer),
  customer: decodeBuyer(value.customer),
  lines: array(value.lines, decodeLine, "lines"),
  vatBreakdown: array(value.vatBreakdown, decodeVatBreakdownEntry, "vatBreakdown"),
  totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
  vatTotal: text(value.vatTotal, "vatTotal"),
  totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  currency: text(value.currency, "currency"),
  series: text(value.series, "series"),
  number: integer(value.number, "number"),
  issueDate: text(value.issueDate, "issueDate"),
})

export const decodeIssuedInvoice: Decoder<IssuedInvoice> = (input) => {
  const value = object(input)
  return {
    ...decodeBody(value),
    id: text(value.id, "id"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    notes: nullableText(value.notes, "notes"),
    // The same closed enum the register decodes, not free text: the detail and
    // the list name one invoice's status, so they must read one contract.
    eFacturaStatus: decodeEFacturaStatus(value.eFacturaStatus),
  }
}

export const decodeCorrectionDocument: Decoder<CorrectionDocument> = (input) => {
  const value = object(input)
  return {
    ...decodeBody(value),
    id: text(value.id, "id"),
    originalInvoiceId: text(value.originalInvoiceId, "originalInvoiceId"),
    reason: text(value.reason, "reason"),
  }
}
