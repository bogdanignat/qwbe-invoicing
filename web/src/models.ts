export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county?: string
  readonly postalCode?: string
}

export interface Party {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends Party {
  readonly partyType: PartyType
}

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly defaultPaymentTermDays?: number
}

export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
}

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

export interface DocumentSource {
  readonly app: string
  readonly kind: string
  readonly id: string
}

export interface VatConfiguration {
  readonly code: string
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface Issuer extends Party {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
}

export type DocumentType = "invoice" | "proforma"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}

export const documentSeriesFor = (documentType: DocumentType) =>
  (series: ReadonlyArray<DocumentSeries>): ReadonlyArray<DocumentSeries> =>
    series.filter((item) => item.documentType === documentType)

export const invoiceDocumentSeries = (series: ReadonlyArray<DocumentSeries>): ReadonlyArray<DocumentSeries> =>
  documentSeriesFor("invoice")(series)

export const proformaDocumentSeries = (series: ReadonlyArray<DocumentSeries>): ReadonlyArray<DocumentSeries> =>
  documentSeriesFor("proforma")(series)

export interface DraftLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
  readonly vatRate: string
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export interface DraftInvoice {
  readonly id: string
  readonly organizationId: string
  readonly customer: BuyerSnapshot
  readonly customerId?: string
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly status: "draft" | "issued" | "proforma_issued"
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export interface VatBreakdown {
  readonly code: string
  readonly rate: string
  readonly vatBaseAmount: string
  readonly vatAmount: string
}

export interface IssuedInvoice {
  readonly id: string
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly issuer: Party
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
  readonly eFacturaStatus: string
}

export interface Proforma {
  readonly id: string
  readonly sourceDraftId: string | null
  readonly source?: DocumentSource
  readonly invoiceSeries: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly issuedAt: string
  readonly currency: string
  readonly issuer: Party
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

export interface Payment {
  readonly id: string
  readonly kind: "payment" | "reversal"
  readonly reversesPaymentId?: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
}

export interface PaymentSummary {
  readonly invoiceId: string
  readonly status: "unpaid" | "partially_paid" | "paid" | "overpaid" | "overdue"
  readonly paidAmount: string
  readonly remainingAmount: string
  readonly payments: ReadonlyArray<Payment>
}

export interface CorrectionDocument {
  readonly id: string
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly reason: string
  readonly currency: string
  readonly totalIncludingVat: string
}

export interface Page<Item> {
  readonly items: ReadonlyArray<Item>
  readonly nextCursor: string | null
}
export interface PageRequest {
  readonly limit?: number
  readonly cursor?: string
}

type JsonObject = Readonly<Record<string, unknown>>
export type Decoder<Value> = (input: unknown) => Value

const object = (input: unknown): JsonObject => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("expected object")
  return input as JsonObject
}
const text = (input: unknown, field: string): string => {
  if (typeof input !== "string") throw new Error(`invalid ${field}`)
  return input
}
const integer = (input: unknown, field: string): number => {
  if (typeof input !== "number" || !Number.isInteger(input)) throw new Error(`invalid ${field}`)
  return input
}
const optionalText = (input: unknown, field: string): string | undefined =>
  input === undefined || input === null ? undefined : text(input, field)
const optionalInteger = (input: unknown, field: string): number | undefined =>
  input === undefined || input === null ? undefined : integer(input, field)
const nullableText = (input: unknown, field: string): string | null =>
  input === null ? null : text(input, field)
const array = <Value>(input: unknown, decode: Decoder<Value>, field: string): ReadonlyArray<Value> => {
  if (!Array.isArray(input)) throw new Error(`invalid ${field}`)
  return input.map(decode)
}

const decodeAddress: Decoder<Address> = (input) => {
  const value = object(input)
  const county = optionalText(value.county, "county")
  const postalCode = optionalText(value.postalCode, "postalCode")
  return {
    countryCode: text(value.countryCode, "countryCode"),
    city: text(value.city, "city"),
    street: text(value.street, "street"),
    ...(county === undefined ? {} : { county }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}

const decodeParty: Decoder<Party> = (input) => {
  const value = object(input)
  return {
    name: text(value.name, "name"),
    fiscalIdentifier: text(value.fiscalIdentifier, "fiscalIdentifier"),
    address: decodeAddress(value.address),
  }
}

const decodePartyType = (input: unknown): PartyType => {
  const value = text(input, "partyType")
  if (value !== "company" && value !== "individual") throw new Error("invalid partyType")
  return value
}

const decodeBuyer: Decoder<BuyerSnapshot> = (input) => {
  const value = object(input)
  return { ...decodeParty(value), partyType: decodePartyType(value.partyType) }
}

export const decodeUnitOfMeasure: Decoder<UnitOfMeasure> = (input) => {
  const value = object(input)
  return { code: text(value.code, "code"), name: text(value.name, "name") }
}

const decodeDocumentSource: Decoder<DocumentSource> = (input) => {
  const value = object(input)
  return { app: text(value.app, "app"), kind: text(value.kind, "kind"), id: text(value.id, "id") }
}

const optionalDocumentSource = (input: unknown): DocumentSource | undefined =>
  input === undefined || input === null ? undefined : decodeDocumentSource(input)

export const decodeCustomer: Decoder<Customer> = (input) => {
  const value = object(input)
  const defaultPaymentTermDays = optionalInteger(value.defaultPaymentTermDays, "defaultPaymentTermDays")
  if (defaultPaymentTermDays !== undefined && defaultPaymentTermDays < 0) throw new Error("invalid defaultPaymentTermDays")
  return {
    ...decodeBuyer(value), id: text(value.id, "id"), organizationId: text(value.organizationId, "organizationId"),
    ...(defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays }),
  }
}

export const decodeProductPreset: Decoder<ProductPreset> = (input) => {
  const value = object(input)
  return {
    id: text(value.id, "id"), organizationId: text(value.organizationId, "organizationId"),
    description: text(value.description, "description"), unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
  }
}

const decodeVatConfiguration: Decoder<VatConfiguration> = (input) => {
  const value = object(input)
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  return {
    code: text(value.code, "code"), rate: text(value.rate, "rate"),
    effectiveFrom: text(value.effectiveFrom, "effectiveFrom"),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
  }
}

export const decodeDocumentSeries: Decoder<DocumentSeries> = (input) => {
  const value = object(input)
  const documentType = text(value.documentType, "documentType")
  if (documentType !== "invoice" && documentType !== "proforma") throw new Error("invalid documentType")
  return {
    organizationId: text(value.organizationId, "organizationId"),
    documentType,
    series: text(value.series, "series"),
  }
}

export const decodeIssuer: Decoder<Issuer> = (input) => {
  const value = object(input)
  return {
    ...decodeParty(value), organizationId: text(value.organizationId, "organizationId"),
    defaultCurrency: text(value.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(value.defaultPaymentTermDays, "defaultPaymentTermDays"),
    vatConfigurations: array(value.vatConfigurations, decodeVatConfiguration, "vatConfigurations"),
  }
}

const decodeDraftLine: Decoder<DraftLine> = (input) => {
  const value = object(input)
  return {
    id: text(value.id, "id"), description: text(value.description, "description"),
    quantity: text(value.quantity, "quantity"), unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    vatRateCode: text(value.vatRateCode, "vatRateCode"), vatRate: text(value.vatRate, "vatRate"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatAmount: text(value.vatAmount, "vatAmount"), totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

const decodeVatBreakdown: Decoder<VatBreakdown> = (input) => {
  const value = object(input)
  return {
    code: text(value.code, "code"), rate: text(value.rate, "rate"),
    vatBaseAmount: text(value.vatBaseAmount, "vatBaseAmount"), vatAmount: text(value.vatAmount, "vatAmount"),
  }
}

export const decodeDraft: Decoder<DraftInvoice> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (status !== "draft" && status !== "issued" && status !== "proforma_issued") throw new Error("invalid status")
  const customerId = optionalText(value.customerId, "customerId")
  const source = optionalDocumentSource(value.source)
  return {
    id: text(value.id, "id"), organizationId: text(value.organizationId, "organizationId"),
    customer: decodeBuyer(value.customer), ...(customerId === undefined ? {} : { customerId }),
    ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), status,
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

export const decodeInvoice: Decoder<IssuedInvoice> = (input) => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    id: text(value.id, "id"), draftId: nullableText(value.draftId, "draftId"),
    sourceProformaId: nullableText(value.sourceProformaId, "sourceProformaId"),
    ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), issuer: decodeParty(value.issuer), customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    eFacturaStatus: text(value.eFacturaStatus, "eFacturaStatus"),
  }
}

export const decodeProforma: Decoder<Proforma> = (input) => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    id: text(value.id, "id"), sourceDraftId: nullableText(value.sourceDraftId, "sourceDraftId"),
    ...(source === undefined ? {} : { source }),
    invoiceSeries: text(value.invoiceSeries, "invoiceSeries"),
    organizationId: text(value.organizationId, "organizationId"), series: text(value.series, "series"),
    number: integer(value.number, "number"), issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"), issuedAt: text(value.issuedAt, "issuedAt"),
    currency: text(value.currency, "currency"), issuer: decodeParty(value.issuer), customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"), vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    convertedDraftId: nullableText(value.convertedDraftId, "convertedDraftId"),
    convertedInvoiceId: nullableText(value.convertedInvoiceId, "convertedInvoiceId"),
  }
}

const decodePayment: Decoder<Payment> = (input) => {
  const value = object(input)
  const externalReference = optionalText(value.externalReference, "externalReference")
  const note = optionalText(value.note, "note")
  const kind = text(value.kind, "kind")
  if (kind !== "payment" && kind !== "reversal") throw new Error("invalid payment kind")
  const reversesPaymentId = optionalText(value.reversesPaymentId, "reversesPaymentId")
  return {
    id: text(value.id, "id"), kind, ...(reversesPaymentId === undefined ? {} : { reversesPaymentId }),
    amount: text(value.amount, "amount"), currency: text(value.currency, "currency"),
    paymentDate: text(value.paymentDate, "paymentDate"), method: text(value.method, "method"),
    ...(externalReference === undefined ? {} : { externalReference }), ...(note === undefined ? {} : { note }),
  }
}

export const decodePaymentSummary: Decoder<PaymentSummary> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (!["unpaid", "partially_paid", "paid", "overpaid", "overdue"].includes(status)) throw new Error("invalid payment status")
  return {
    invoiceId: text(value.invoiceId, "invoiceId"), status: status as PaymentSummary["status"],
    paidAmount: text(value.paidAmount, "paidAmount"), remainingAmount: text(value.remainingAmount, "remainingAmount"),
    payments: array(value.payments, decodePayment, "payments"),
  }
}

export const decodeCorrection: Decoder<CorrectionDocument> = (input) => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    id: text(value.id, "id"), ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), reason: text(value.reason, "reason"),
    currency: text(value.currency, "currency"), totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

export const decodePage = <Item>(decodeItem: Decoder<Item>): Decoder<Page<Item>> => (input) => {
  const value = object(input)
  return { items: array(value.items, decodeItem, "items"), nextCursor: nullableText(value.nextCursor, "nextCursor") }
}
export const decodeCustomerPage = decodePage(decodeCustomer)
export const decodeProductPresetPage = decodePage(decodeProductPreset)
export const decodeDraftPage = decodePage(decodeDraft)
export const decodeInvoicePage = decodePage(decodeInvoice)
export const decodeProformaPage = decodePage(decodeProforma)

export const decodeProductPresets: Decoder<ReadonlyArray<ProductPreset>> = (input) => array(input, decodeProductPreset, "productPresets")
export const decodeUnitOfMeasures: Decoder<ReadonlyArray<UnitOfMeasure>> = (input) => array(input, decodeUnitOfMeasure, "unitOfMeasures")

export const decodeCustomers: Decoder<ReadonlyArray<Customer>> = (input) => array(input, decodeCustomer, "customers")
export const decodeDocumentSeriesList: Decoder<ReadonlyArray<DocumentSeries>> = (input) => array(input, decodeDocumentSeries, "documentSeries")
export const decodeInvoices: Decoder<ReadonlyArray<IssuedInvoice>> = (input) => array(input, decodeInvoice, "invoices")
export const decodeDrafts: Decoder<ReadonlyArray<DraftInvoice>> = (input) => array(input, decodeDraft, "drafts")
export const decodeProformas: Decoder<ReadonlyArray<Proforma>> = (input) => array(input, decodeProforma, "proformas")
export const decodeCorrections: Decoder<ReadonlyArray<CorrectionDocument>> = (input) => array(input, decodeCorrection, "corrections")
export const decodeDeleted: Decoder<{ readonly deleted: true }> = (input) => {
  const value = object(input)
  if (value.deleted !== true) throw new Error("invalid deletion response")
  return { deleted: true }
}
