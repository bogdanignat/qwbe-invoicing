import { formatAmount, formatRate, money } from "./money.ts"
import { receivedKindLabel, spvDate } from "./received-projection.ts"
import { receivedWarningText } from "./received-warnings.ts"
import type { Amount, Quantity, ReceivedDetail, ReceivedLine, ReceivedParty } from "./received-models.ts"

/**
 * A read received invoice as the detail renders it. Quantities and prices keep
 * the XML's precision (`formatAmount` only groups thousands); the VAT in the
 * tax currency (RON for an invoice in EUR) is shown when the document gives it.
 */
export interface Fact { readonly label: string; readonly value: string }
export interface PartyView { readonly heading: string; readonly name: string; readonly details: ReadonlyArray<string> }
export interface LineView {
  readonly key: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly vat: string
  readonly net: string
}
export interface VatRowView { readonly key: string; readonly rate: string; readonly base: string; readonly amount: string; readonly note: string }

export interface ReceivedDocumentView {
  readonly heading: string
  readonly facts: ReadonlyArray<Fact>
  readonly parties: ReadonlyArray<PartyView>
  readonly lines: ReadonlyArray<LineView>
  readonly vatRows: ReadonlyArray<VatRowView>
  readonly totals: ReadonlyArray<Fact>
  readonly notes: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

const DASH = "—"
const amountText = (amount: Amount): string => money(amount.value, amount.currency)
const quantityText = (quantity: Quantity): string =>
  quantity.unit === undefined ? formatAmount(quantity.value) : `${formatAmount(quantity.value)} ${quantity.unit}`
const vatText = (category: string | undefined, percent: string | undefined): string =>
  [category, percent === undefined ? undefined : `${formatRate(percent)}%`].filter((part) => part !== undefined).join(" ") || DASH
const present = (facts: ReadonlyArray<Fact | undefined>) => facts.filter((fact) => fact !== undefined)
const optional = (label: string, amount: Amount | undefined): Fact | undefined =>
  amount === undefined ? undefined : { label, value: amountText(amount) }

const partyView = (heading: string, party: ReceivedParty, accounts: ReadonlyArray<string> = []): PartyView => {
  const address = [party.address?.street, party.address?.city, party.address?.county, party.address?.country]
    .filter((part) => part !== undefined).join(", ")
  const details = [
    party.vatId === undefined ? undefined : `Cod TVA: ${party.vatId}`,
    party.taxRegistrationId === undefined ? undefined : `CIF: ${party.taxRegistrationId}`,
    party.registrationId === undefined ? undefined : `Nr. înregistrare: ${party.registrationId}`,
    address === "" ? undefined : address,
    ...accounts.map((account) => `IBAN: ${account}`),
  ]
  return { heading, name: party.name ?? DASH, details: details.filter((detail) => detail !== undefined) }
}

const lineView = (line: ReceivedLine, index: number): LineView => {
  const base = line.priceBaseQuantity === undefined ? "" : ` / ${quantityText(line.priceBaseQuantity)}`
  return {
    key: `${String(index)}:${line.id}`,
    description: [line.name, line.description].filter((part) => part !== undefined).join(" — ") || DASH,
    quantity: line.quantity === undefined ? DASH : quantityText(line.quantity),
    unitPrice: line.unitPrice === undefined ? DASH : `${amountText(line.unitPrice)}${base}`,
    vat: vatText(line.vatCategory, line.vatPercent),
    net: amountText(line.netAmount),
  }
}

export const projectReceivedDocument = (detail: Extract<ReceivedDetail, { readable: true }>): ReceivedDocumentView => {
  const { document, listing } = detail
  const { totals } = document
  return {
    heading: `${receivedKindLabel(listing.kind)} ${listing.number}`,
    facts: [
      { label: "Data emiterii", value: listing.issueDate },
      { label: "Scadență", value: document.dueDate ?? DASH },
      { label: "Monedă", value: document.currency },
      { label: "Primită în SPV", value: spvDate(detail.spvCreatedAt) },
      { label: "Mesaj SPV", value: detail.messageId },
    ],
    parties: [partyView("Furnizor", document.supplier, document.paymentAccounts), partyView("Cumpărător", document.buyer)],
    lines: document.lines.map(lineView),
    vatRows: document.vatRows.map((row, index) => ({
      key: `${String(index)}:${row.category}:${row.percent ?? ""}`, rate: vatText(row.category, row.percent),
      base: amountText(row.taxable), amount: amountText(row.tax), note: row.exemptionReason ?? DASH,
    })),
    totals: present([
      { label: "Total linii", value: amountText(totals.lineExtension) },
      optional("Reduceri", totals.allowanceTotal),
      optional("Taxe suplimentare", totals.chargeTotal),
      { label: "Total fără TVA", value: amountText(totals.taxExclusive) },
      optional("TVA", document.vatTotal),
      optional(`TVA în ${document.vatInTaxCurrency?.currency ?? ""}`, document.vatInTaxCurrency),
      { label: "Total cu TVA", value: amountText(totals.taxInclusive) },
      optional("Plătit în avans", totals.prepaid),
      optional("Rotunjire", totals.rounding),
      { label: "De plată", value: amountText(totals.payable) },
    ]),
    notes: document.notes,
    warnings: detail.warnings.map(receivedWarningText),
  }
}
