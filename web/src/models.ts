export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county?: string
  readonly postalCode?: string
}

export interface Party {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: Address
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends Party {
  readonly partyType: PartyType
}

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
}

export interface TaxConfiguration {
  readonly code: string
  readonly category: "standard"
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface Issuer extends Party {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
}

export type DocumentType = "invoice" | "proforma"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}

export const invoiceDocumentSeries = (series: ReadonlyArray<DocumentSeries>): ReadonlyArray<DocumentSeries> =>
  series.filter((item) => item.documentType === "invoice")

export interface DraftLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
  readonly taxCategory: "standard"
  readonly taxRate: string
  readonly totalExcludingTax: string
  readonly taxAmount: string
  readonly totalIncludingTax: string
}

export interface DraftInvoice {
  readonly id: string
  readonly organizationId: string
  readonly customer: BuyerSnapshot
  readonly customerId?: string
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string
  readonly currency: string
  readonly status: "draft" | "issued"
  readonly lines: ReadonlyArray<DraftLine>
  readonly taxBreakdown: ReadonlyArray<TaxBreakdown>
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly totalIncludingTax: string
}

export interface TaxBreakdown {
  readonly taxCode: string
  readonly category: "standard"
  readonly rate: string
  readonly taxableAmount: string
  readonly taxAmount: string
}

export interface IssuedInvoice {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string
  readonly currency: string
  readonly issuer: Party
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly taxBreakdown: ReadonlyArray<TaxBreakdown>
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly totalIncludingTax: string
  readonly eFacturaStatus: string
}

export interface Payment {
  readonly id: string
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
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly reason: string
  readonly currency: string
  readonly totalIncludingTax: string
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
    legalName: text(value.legalName, "legalName"),
    taxIdentifier: text(value.taxIdentifier, "taxIdentifier"),
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

export const decodeCustomer: Decoder<Customer> = (input) => {
  const value = object(input)
  return { ...decodeBuyer(value), id: text(value.id, "id"), organizationId: text(value.organizationId, "organizationId") }
}

const decodeTaxConfiguration: Decoder<TaxConfiguration> = (input) => {
  const value = object(input)
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  return {
    code: text(value.code, "code"), category: "standard", rate: text(value.rate, "rate"),
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
    taxConfigurations: array(value.taxConfigurations, decodeTaxConfiguration, "taxConfigurations"),
  }
}

const decodeDraftLine: Decoder<DraftLine> = (input) => {
  const value = object(input)
  const taxCategory = text(value.taxCategory, "taxCategory")
  if (taxCategory !== "standard") throw new Error("invalid taxCategory")
  return {
    id: text(value.id, "id"), description: text(value.description, "description"),
    quantity: text(value.quantity, "quantity"), unitPrice: text(value.unitPrice, "unitPrice"),
    taxCode: text(value.taxCode, "taxCode"), taxCategory, taxRate: text(value.taxRate, "taxRate"),
    totalExcludingTax: text(value.totalExcludingTax, "totalExcludingTax"),
    taxAmount: text(value.taxAmount, "taxAmount"), totalIncludingTax: text(value.totalIncludingTax, "totalIncludingTax"),
  }
}

const decodeTaxBreakdown: Decoder<TaxBreakdown> = (input) => {
  const value = object(input)
  const category = text(value.category, "category")
  if (category !== "standard") throw new Error("invalid category")
  return {
    taxCode: text(value.taxCode, "taxCode"), category, rate: text(value.rate, "rate"),
    taxableAmount: text(value.taxableAmount, "taxableAmount"), taxAmount: text(value.taxAmount, "taxAmount"),
  }
}

export const decodeDraft: Decoder<DraftInvoice> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (status !== "draft" && status !== "issued") throw new Error("invalid status")
  const customerId = optionalText(value.customerId, "customerId")
  return {
    id: text(value.id, "id"), organizationId: text(value.organizationId, "organizationId"),
    customer: decodeBuyer(value.customer), ...(customerId === undefined ? {} : { customerId }),
    series: text(value.series, "series"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: text(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), status,
    lines: array(value.lines, decodeDraftLine, "lines"),
    taxBreakdown: array(value.taxBreakdown, decodeTaxBreakdown, "taxBreakdown"),
    totalExcludingTax: text(value.totalExcludingTax, "totalExcludingTax"), taxTotal: text(value.taxTotal, "taxTotal"),
    totalIncludingTax: text(value.totalIncludingTax, "totalIncludingTax"),
  }
}

export const decodeInvoice: Decoder<IssuedInvoice> = (input) => {
  const value = object(input)
  return {
    id: text(value.id, "id"), series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: text(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), issuer: decodeParty(value.issuer), customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"),
    taxBreakdown: array(value.taxBreakdown, decodeTaxBreakdown, "taxBreakdown"),
    totalExcludingTax: text(value.totalExcludingTax, "totalExcludingTax"), taxTotal: text(value.taxTotal, "taxTotal"),
    totalIncludingTax: text(value.totalIncludingTax, "totalIncludingTax"),
    eFacturaStatus: text(value.eFacturaStatus, "eFacturaStatus"),
  }
}

const decodePayment: Decoder<Payment> = (input) => {
  const value = object(input)
  const externalReference = optionalText(value.externalReference, "externalReference")
  const note = optionalText(value.note, "note")
  return {
    id: text(value.id, "id"), amount: text(value.amount, "amount"), currency: text(value.currency, "currency"),
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
  return {
    id: text(value.id, "id"), series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), reason: text(value.reason, "reason"),
    currency: text(value.currency, "currency"), totalIncludingTax: text(value.totalIncludingTax, "totalIncludingTax"),
  }
}

export const decodeCustomers: Decoder<ReadonlyArray<Customer>> = (input) => array(input, decodeCustomer, "customers")
export const decodeDocumentSeriesList: Decoder<ReadonlyArray<DocumentSeries>> = (input) => array(input, decodeDocumentSeries, "documentSeries")
export const decodeInvoices: Decoder<ReadonlyArray<IssuedInvoice>> = (input) => array(input, decodeInvoice, "invoices")
export const decodeDrafts: Decoder<ReadonlyArray<DraftInvoice>> = (input) => array(input, decodeDraft, "drafts")
export const decodeCorrections: Decoder<ReadonlyArray<CorrectionDocument>> = (input) => array(input, decodeCorrection, "corrections")
export const decodeDeleted: Decoder<{ readonly deleted: true }> = (input) => {
  const value = object(input)
  if (value.deleted !== true) throw new Error("invalid deletion response")
  return { deleted: true }
}
