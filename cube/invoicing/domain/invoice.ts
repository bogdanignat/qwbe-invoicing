export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county?: string
  readonly postalCode?: string
}

export interface PartySnapshot {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: Address
}

export interface TaxConfiguration {
  readonly code: string
  readonly category: "standard"
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface IssuerProfile extends PartySnapshot {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly defaultSeries: string
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
}

export interface Customer extends PartySnapshot {
  readonly id: string
  readonly organizationId: string
  readonly deletedAt?: string
}

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
  readonly customerId: string
  readonly issueDate: string
  readonly dueDate: string
  readonly currency: string
  readonly status: "draft" | "issued"
  readonly lines: ReadonlyArray<DraftLine>
}

export interface TaxBreakdown {
  readonly taxCode: string
  readonly category: "standard"
  readonly rate: string
  readonly taxableAmount: string
  readonly taxAmount: string
}

export type EFacturaStatus = "not_sent" | "pending" | "sent" | "accepted" | "rejected"
export interface IssuedInvoice {
  readonly id: string
  readonly draftId: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string
  readonly issuedAt: string
  readonly currency: string
  readonly issuer: PartySnapshot
  readonly customer: PartySnapshot
  readonly lines: ReadonlyArray<DraftLine>
  readonly taxBreakdown: ReadonlyArray<TaxBreakdown>
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly totalIncludingTax: string
  readonly eFacturaStatus: EFacturaStatus
}

export interface ConfigureIssuerInput {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: Address
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly defaultSeries: string
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
}

export interface CreateCustomerInput {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: Address
}

export interface CreateDraftInput {
  readonly customerId: string
  readonly issueDate: string
  readonly currency?: string
  readonly dueDate?: string
}

export interface AddDraftLineInput {
  readonly draftId: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
}

export const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
