import { issuerIssuanceWarning, normalizeIssuerLegalDetails, type IssuerLegalDetails, type LegalForm } from "./issuer-details.ts"
import { isRomanianCountyCode } from "./romanian-counties.ts"

export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county: string
  readonly sector?: number
  readonly postalCode?: string
}

export interface Party {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
}

export interface IssuerBrandingImage {
  readonly pngBase64: string
  readonly width: number
  readonly height: number
}

export interface IssuerBranding {
  readonly text: string | null
  readonly image: IssuerBrandingImage | null
}

export type { LegalForm } from "./issuer-details.ts"

export interface IssuerCompanySnapshot extends Party {
  readonly vatRegistered: boolean
  readonly legalForm: LegalForm
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
}

export interface IssuerSnapshot extends IssuerCompanySnapshot {
  readonly branding: IssuerBranding | null
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends Party {
  readonly partyType: PartyType
  readonly vatRegistered: boolean
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
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export type VatCategoryCode = "S" | "E"
export type NonVatBasis = "article_310"

interface VatRegistrationPeriod {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export type VatRegistration = VatRegistrationPeriod & ({
  readonly registered: true
  readonly nonVatBasis?: never
} | {
  readonly registered: false
  readonly nonVatBasis: NonVatBasis
})

export type VatChange = {
  readonly registered: true
  readonly effectiveFrom: string
  readonly nonVatBasis?: never
} | {
  readonly registered: false
  readonly effectiveFrom: string
  readonly nonVatBasis: NonVatBasis
}

export interface VatRate extends VatConfiguration {
  readonly kind: "standard" | "reduced" | "non_vat"
  readonly label: string
}

export interface VatCatalogue {
  readonly rates: ReadonlyArray<VatRate>
}

export interface Issuer extends Omit<IssuerSnapshot, "vatRegistered"> {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
  readonly currentVat: VatRegistration | null
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
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
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
  readonly sourceProformaId: string | null
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly notes: string | null
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
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly vatBaseAmount: string
  readonly vatAmount: string
}

export interface IssuedInvoice {
  readonly actorId: string
  readonly id: string
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly notes: string | null
  readonly issuer: IssuerSnapshot
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
  readonly eFacturaStatus: string
}

export type IssuedInvoiceSummary = Omit<IssuedInvoice, "issuer"> & { readonly issuer: IssuerCompanySnapshot }

export interface Proforma {
  readonly actorId: string
  readonly id: string
  readonly sourceDraftId: string | null
  readonly source?: DocumentSource
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly issuedAt: string
  readonly currency: string
  readonly notes: string | null
  readonly issuer: IssuerSnapshot
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

export type ProformaSummary = Omit<Proforma, "issuer"> & { readonly issuer: IssuerCompanySnapshot }

export interface Payment {
  readonly actorId: string
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
  readonly actorId: string
  readonly id: string
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly reason: string
  readonly currency: string
  readonly issuer: IssuerCompanySnapshot
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
const boolean = (input: unknown, field: string): boolean => {
  if (typeof input !== "boolean") throw new Error(`invalid ${field}`)
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
  const county = text(value.county, "county")
  const sector = optionalInteger(value.sector, "sector")
  const postalCode = optionalText(value.postalCode, "postalCode")
  if (!isRomanianCountyCode(county)) throw new Error("invalid county")
  if (county === "RO-B" ? sector === undefined || sector < 1 || sector > 6 : sector !== undefined) throw new Error("invalid sector")
  return {
    countryCode: text(value.countryCode, "countryCode"),
    city: text(value.city, "city"),
    street: text(value.street, "street"),
    county,
    ...(sector === undefined ? {} : { sector }),
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

const canonicalCui = (value: string): string => {
  if (!/^[0-9]+$/.test(value)) throw new Error("invalid fiscalIdentifier")
  return value
}

const decodeIssuerCompany = (input: unknown): Party & IssuerLegalDetails => {
  const value = object(input)
  const raw = {
    legalForm: text(value.legalForm, "legalForm"),
    tradeRegistryNumber: text(value.tradeRegistryNumber, "tradeRegistryNumber"),
    iban: text(value.iban, "iban"),
    bankName: text(value.bankName, "bankName"),
    socialCapital: text(value.socialCapital, "socialCapital"),
  }
  let details: IssuerLegalDetails
  try { details = normalizeIssuerLegalDetails(raw) } catch (cause) {
    throw new Error(cause instanceof Error ? `invalid issuer details: ${cause.message}` : "invalid issuer details", { cause })
  }
  for (const field of ["tradeRegistryNumber", "iban", "bankName", "socialCapital"] as const) {
    if (details[field] !== raw[field]) throw new Error(`invalid ${field}`)
  }
  const party = decodeParty(value)
  return { ...party, fiscalIdentifier: canonicalCui(party.fiscalIdentifier), ...details }
}

const decodeIssuerCompanySnapshot: Decoder<IssuerCompanySnapshot> = (input) => {
  const value = object(input)
  return { ...decodeIssuerCompany(value), vatRegistered: boolean(value.vatRegistered, "vatRegistered") }
}

const decodeIssuedIssuerCompanySnapshot: Decoder<IssuerCompanySnapshot> = (input) => {
  const issuer = decodeIssuerCompanySnapshot(input)
  const issue = issuerIssuanceWarning(issuer)
  if (issue !== undefined) throw new Error(`invalid issued issuer: ${issue}`)
  return issuer
}

const decodeIssuerBrandingImage: Decoder<IssuerBrandingImage> = (input) => {
  const value = object(input)
  const pngBase64 = text(value.pngBase64, "pngBase64")
  const width = integer(value.width, "width")
  const height = integer(value.height, "height")
  if (pngBase64.length === 0 || width <= 0 || height <= 0) throw new Error("invalid issuer branding image")
  return { pngBase64, width, height }
}

const decodeIssuerBranding: Decoder<IssuerBranding> = (input) => {
  const value = object(input)
  return {
    text: nullableText(value.text, "branding.text"),
    image: value.image === null ? null : decodeIssuerBrandingImage(value.image),
  }
}

const decodeIssuerSnapshot: Decoder<IssuerSnapshot> = (input) => {
  const value = object(input)
  return { ...decodeIssuedIssuerCompanySnapshot(value), branding: value.branding === null ? null : decodeIssuerBranding(value.branding) }
}

const decodeIssuerProfileSnapshot: Decoder<Omit<IssuerSnapshot, "vatRegistered">> = (input) => {
  const value = object(input)
  return { ...decodeIssuerCompany(value), branding: value.branding === null ? null : decodeIssuerBranding(value.branding) }
}

const decodePartyType = (input: unknown): PartyType => {
  const value = text(input, "partyType")
  if (value !== "company" && value !== "individual") throw new Error("invalid partyType")
  return value
}

const decodeBuyer: Decoder<BuyerSnapshot> = (input) => {
  const value = object(input)
  const partyType = decodePartyType(value.partyType)
  const vatRegistered = boolean(value.vatRegistered, "vatRegistered")
  if (partyType === "individual" && vatRegistered) throw new Error("invalid vatRegistered")
  const party = decodeParty(value)
  const fiscalIdentifier = partyType === "company" ? canonicalCui(party.fiscalIdentifier) : party.fiscalIdentifier
  if (partyType === "individual" && fiscalIdentifier !== "" && !/^[0-9]{13}$/.test(fiscalIdentifier)) throw new Error("invalid fiscalIdentifier")
  return { ...party, fiscalIdentifier, partyType, vatRegistered }
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

export const ARTICLE_310_EXEMPTION_REASON = "Regim special de scutire conform art. 310 din Codul fiscal"
export const isTaxableVatCode = (code: string): boolean => ["RO_STANDARD", "RO_REDUCED", "RO_REDUCED_5"].includes(code)

const decodeVatCategoryCode = (input: unknown): VatCategoryCode => {
  const value = text(input, "vatCategoryCode")
  if (value !== "S" && value !== "E") throw new Error("invalid vatCategoryCode")
  return value
}

const canonicalVatTreatment = (code: string, rate: string, vatCategoryCode: VatCategoryCode, vatExemptionReason: string | null): void => {
  const numericRate = Number(rate)
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(rate) || numericRate > 100) throw new Error("invalid rate")
  if (vatCategoryCode === "S" && (numericRate <= 0 || vatExemptionReason !== null || !isTaxableVatCode(code))) throw new Error("invalid S VAT treatment")
  if (vatCategoryCode === "E" && (code !== "RO_NON_VAT" || numericRate !== 0 || vatExemptionReason !== ARTICLE_310_EXEMPTION_REASON)) throw new Error("invalid E VAT treatment")
}

const decodeVatConfiguration: Decoder<VatConfiguration> = (input) => {
  const value = object(input)
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  const configuration = {
    code: text(value.code, "code"), rate: text(value.rate, "rate"), vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    effectiveFrom: text(value.effectiveFrom, "effectiveFrom"),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
  }
  canonicalVatTreatment(configuration.code, configuration.rate, configuration.vatCategoryCode, configuration.vatExemptionReason)
  return configuration
}

const decodeVatRegistration: Decoder<VatRegistration> = (input) => {
  const value = object(input)
  if (typeof value.registered !== "boolean") throw new Error("invalid registered")
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  const period = { effectiveFrom: text(value.effectiveFrom, "effectiveFrom"), ...(effectiveTo === undefined ? {} : { effectiveTo }) }
  if (value.registered) {
    if (Object.hasOwn(value, "nonVatBasis")) throw new Error("invalid nonVatBasis")
    return { registered: true, ...period }
  }
  if (value.nonVatBasis !== "article_310") throw new Error("invalid nonVatBasis")
  return { registered: false, nonVatBasis: "article_310", ...period }
}

const decodeVatRate: Decoder<VatRate> = (input) => {
  const value = object(input)
  const kind = text(value.kind, "kind")
  if (kind !== "standard" && kind !== "reduced" && kind !== "non_vat") throw new Error("invalid VAT kind")
  const configuration = decodeVatConfiguration(value)
  if ((kind === "non_vat") !== (configuration.vatCategoryCode === "E")) throw new Error("invalid VAT kind treatment")
  if ((kind === "standard") !== (configuration.code === "RO_STANDARD") || (kind === "reduced") !== ["RO_REDUCED", "RO_REDUCED_5"].includes(configuration.code)) throw new Error("invalid VAT kind code")
  return { ...configuration, kind, label: text(value.label, "label") }
}

export const decodeVatCatalogue: Decoder<VatCatalogue> = (input) => {
  const value = object(input)
  return { rates: array(value.rates, decodeVatRate, "rates") }
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
  const vatConfigurations = array(value.vatConfigurations, decodeVatConfiguration, "vatConfigurations")
  const currentVat = value.currentVat === null ? null : decodeVatRegistration(value.currentVat)
  if (currentVat !== null) {
    const active = vatConfigurations.filter(({ effectiveFrom, effectiveTo }) => effectiveFrom <= currentVat.effectiveFrom
      && (effectiveTo === undefined || currentVat.effectiveFrom <= effectiveTo))
    const validProjection = active.length > 0 && (currentVat.registered
      ? active.every(({ vatCategoryCode }) => vatCategoryCode === "S")
      : active.every(({ vatCategoryCode }) => vatCategoryCode === "E"))
    if (!validProjection) throw new Error("invalid currentVat projection")
  }
  return {
    ...decodeIssuerProfileSnapshot(value), organizationId: text(value.organizationId, "organizationId"),
    defaultCurrency: text(value.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(value.defaultPaymentTermDays, "defaultPaymentTermDays"),
    vatConfigurations,
    currentVat,
  }
}

const decodeDraftLine: Decoder<DraftLine> = (input) => {
  const value = object(input)
  const line = {
    id: text(value.id, "id"), description: text(value.description, "description"),
    quantity: text(value.quantity, "quantity"), unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    vatRateCode: text(value.vatRateCode, "vatRateCode"), vatRate: text(value.vatRate, "vatRate"),
    vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode), vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatAmount: text(value.vatAmount, "vatAmount"), totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
  canonicalVatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
  return line
}

const decodeVatBreakdown: Decoder<VatBreakdown> = (input) => {
  const value = object(input)
  const breakdown = {
    code: text(value.code, "code"), rate: text(value.rate, "rate"), vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    vatBaseAmount: text(value.vatBaseAmount, "vatBaseAmount"), vatAmount: text(value.vatAmount, "vatAmount"),
  }
  canonicalVatTreatment(breakdown.code, breakdown.rate, breakdown.vatCategoryCode, breakdown.vatExemptionReason)
  return breakdown
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
    ...(source === undefined ? {} : { source }), sourceProformaId: nullableText(value.sourceProformaId, "sourceProformaId"),
    series: text(value.series, "series"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), notes: nullableText(value.notes, "notes"), status,
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

const decodeInvoiceWithIssuer = <Value extends IssuerCompanySnapshot>(input: unknown, decodeDocumentIssuer: Decoder<Value>): Omit<IssuedInvoice, "issuer"> & { readonly issuer: Value } => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"), draftId: nullableText(value.draftId, "draftId"),
    sourceProformaId: nullableText(value.sourceProformaId, "sourceProformaId"),
    ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"), notes: nullableText(value.notes, "notes"),
    issuer: decodeDocumentIssuer(value.issuer), customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    eFacturaStatus: text(value.eFacturaStatus, "eFacturaStatus"),
  }
}

export const decodeInvoice: Decoder<IssuedInvoice> = (input) => decodeInvoiceWithIssuer(input, decodeIssuerSnapshot)
export const decodeInvoiceSummary: Decoder<IssuedInvoiceSummary> = (input) => decodeInvoiceWithIssuer(input, decodeIssuedIssuerCompanySnapshot)

const decodeProformaWithIssuer = <Value extends IssuerCompanySnapshot>(input: unknown, decodeDocumentIssuer: Decoder<Value>): Omit<Proforma, "issuer"> & { readonly issuer: Value } => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"), sourceDraftId: nullableText(value.sourceDraftId, "sourceDraftId"),
    ...(source === undefined ? {} : { source }),
    organizationId: text(value.organizationId, "organizationId"), series: text(value.series, "series"),
    number: integer(value.number, "number"), issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"), issuedAt: text(value.issuedAt, "issuedAt"),
    currency: text(value.currency, "currency"), notes: nullableText(value.notes, "notes"),
    issuer: decodeDocumentIssuer(value.issuer), customer: decodeBuyer(value.customer),
    lines: array(value.lines, decodeDraftLine, "lines"), vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"), vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
    convertedDraftId: nullableText(value.convertedDraftId, "convertedDraftId"),
    convertedInvoiceId: nullableText(value.convertedInvoiceId, "convertedInvoiceId"),
  }
}


export const decodeProforma: Decoder<Proforma> = (input) => decodeProformaWithIssuer(input, decodeIssuerSnapshot)
export const decodeProformaSummary: Decoder<ProformaSummary> = (input) => decodeProformaWithIssuer(input, decodeIssuedIssuerCompanySnapshot)

const decodePayment: Decoder<Payment> = (input) => {
  const value = object(input)
  const externalReference = optionalText(value.externalReference, "externalReference")
  const note = optionalText(value.note, "note")
  const kind = text(value.kind, "kind")
  if (kind !== "payment" && kind !== "reversal") throw new Error("invalid payment kind")
  const reversesPaymentId = optionalText(value.reversesPaymentId, "reversesPaymentId")
  return {
    actorId: text(value.actorId, "actorId"),
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
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"), ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"), number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"), reason: text(value.reason, "reason"), issuer: decodeIssuedIssuerCompanySnapshot(value.issuer),
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
export const decodeInvoicePage = decodePage(decodeInvoiceSummary)
export const decodeProformaPage = decodePage(decodeProformaSummary)

export const decodeProductPresets: Decoder<ReadonlyArray<ProductPreset>> = (input) => array(input, decodeProductPreset, "productPresets")
export const decodeUnitOfMeasures: Decoder<ReadonlyArray<UnitOfMeasure>> = (input) => array(input, decodeUnitOfMeasure, "unitOfMeasures")

export const decodeCustomers: Decoder<ReadonlyArray<Customer>> = (input) => array(input, decodeCustomer, "customers")
export const decodeDocumentSeriesList: Decoder<ReadonlyArray<DocumentSeries>> = (input) => array(input, decodeDocumentSeries, "documentSeries")
export const decodeInvoices: Decoder<ReadonlyArray<IssuedInvoiceSummary>> = (input) => array(input, decodeInvoiceSummary, "invoices")
export const decodeDrafts: Decoder<ReadonlyArray<DraftInvoice>> = (input) => array(input, decodeDraft, "drafts")
export const decodeProformas: Decoder<ReadonlyArray<ProformaSummary>> = (input) => array(input, decodeProformaSummary, "proformas")
export const decodeCorrections: Decoder<ReadonlyArray<CorrectionDocument>> = (input) => array(input, decodeCorrection, "corrections")
export const decodeDeleted: Decoder<{ readonly deleted: true }> = (input) => {
  const value = object(input)
  if (value.deleted !== true) throw new Error("invalid deletion response")
  return { deleted: true }
}
