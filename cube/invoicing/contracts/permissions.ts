export interface InvoicingPermissions {
  readonly read: string
  readonly manageCustomers: string
  readonly draftInvoices: string
  readonly issueInvoices: string
  readonly voidInvoices: string
  readonly recordPayments: string
  readonly manageSettings: string
}

export const invoicingPermissions = (cubeIdentity: string): InvoicingPermissions => ({
  read: `${cubeIdentity}:read`,
  manageCustomers: `${cubeIdentity}:customer.manage`,
  draftInvoices: `${cubeIdentity}:invoice.draft`,
  issueInvoices: `${cubeIdentity}:invoice.issue`,
  voidInvoices: `${cubeIdentity}:invoice.void`,
  recordPayments: `${cubeIdentity}:payment.record`,
  manageSettings: `${cubeIdentity}:settings.manage`,
})
