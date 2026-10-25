import { array, object, optionalText, text } from "./model-decoder.ts"
import type {
  Amount, Quantity, ReceivedAddress, ReceivedDocument, ReceivedLine, ReceivedParty, ReceivedTotals, ReceivedVatRow,
} from "./received-models.ts"

/**
 * The normalized document of a read invoice (`content`), narrowed to what the
 * detail shows. Values stay the XML's strings: nothing is parsed or rounded here.
 */
const amount = (input: unknown, field: string): Amount => {
  const value = object(input)
  return { value: text(value.value, `${field}.value`), currency: text(value.currency, `${field}.currency`) }
}

const optionalAmount = (input: unknown, field: string): Amount | undefined =>
  input === undefined || input === null ? undefined : amount(input, field)

const quantity = (input: unknown, field: string): Quantity | undefined => {
  if (input === undefined || input === null) return undefined
  const value = object(input)
  return { value: text(value.value, `${field}.value`), unit: optionalText(value.unit, `${field}.unit`) }
}

const address = (input: unknown): ReceivedAddress | undefined => {
  if (input === undefined || input === null) return undefined
  const value = object(input)
  return {
    street: optionalText(value.street, "street"), city: optionalText(value.city, "city"),
    county: optionalText(value.county, "county"), country: optionalText(value.country, "country"),
  }
}

const party = (input: unknown): ReceivedParty => {
  const value = object(input)
  return {
    name: optionalText(value.name, "name"), vatId: optionalText(value.vatId, "vatId"),
    taxRegistrationId: optionalText(value.taxRegistrationId, "taxRegistrationId"),
    registrationId: optionalText(value.registrationId, "registrationId"), address: address(value.address),
  }
}

const vatRow = (input: unknown): ReceivedVatRow => {
  const value = object(input)
  return {
    category: text(value.category, "category"), percent: optionalText(value.percent, "percent"),
    taxable: amount(value.taxable, "taxable"), tax: amount(value.tax, "tax"),
    exemptionReason: optionalText(value.exemptionReason, "exemptionReason") ?? optionalText(value.exemptionCode, "exemptionCode"),
  }
}

const line = (input: unknown): ReceivedLine => {
  const value = object(input)
  return {
    id: text(value.id, "line.id"), name: optionalText(value.name, "line.name"), description: optionalText(value.description, "line.description"),
    quantity: quantity(value.quantity, "quantity"), priceBaseQuantity: quantity(value.priceBaseQuantity, "priceBaseQuantity"),
    unitPrice: optionalAmount(value.unitPrice, "unitPrice"), netAmount: amount(value.netAmount, "netAmount"),
    vatCategory: optionalText(value.vatCategory, "vatCategory"), vatPercent: optionalText(value.vatPercent, "vatPercent"),
  }
}

const totals = (input: unknown): ReceivedTotals => {
  const value = object(input)
  return {
    lineExtension: amount(value.lineExtension, "lineExtension"), taxExclusive: amount(value.taxExclusive, "taxExclusive"),
    taxInclusive: amount(value.taxInclusive, "taxInclusive"), allowanceTotal: optionalAmount(value.allowanceTotal, "allowanceTotal"),
    chargeTotal: optionalAmount(value.chargeTotal, "chargeTotal"), prepaid: optionalAmount(value.prepaid, "prepaid"),
    rounding: optionalAmount(value.rounding, "rounding"), payable: amount(value.payable, "payable"),
  }
}

export const decodeReceivedDocument = (input: unknown): ReceivedDocument => {
  const value = object(input)
  const vat = object(value.vat)
  return {
    dueDate: optionalText(value.dueDate, "dueDate"), currency: text(value.currency, "currency"),
    notes: array(value.notes, (note) => text(note, "notes"), "notes"),
    supplier: party(value.supplier), buyer: party(value.buyer),
    paymentAccounts: array(value.paymentAccounts, (account) => text(account, "paymentAccounts"), "paymentAccounts"),
    totals: totals(value.totals),
    vatTotal: optionalAmount(vat.total, "vat.total"), vatInTaxCurrency: optionalAmount(vat.taxCurrencyTotal, "vat.taxCurrencyTotal"),
    vatRows: array(vat.breakdown, vatRow, "vat.breakdown"), lines: array(value.lines, line, "lines"),
  }
}
