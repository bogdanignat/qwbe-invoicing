export interface InvoicingPermissions {
  readonly read: string
  readonly manageCustomers: string
  readonly draftInvoices: string
  readonly issueInvoices: string
  readonly issueProformas: string
  readonly voidInvoices: string
  readonly manageSettings: string
}

export const invoicingPermissions = (cubeIdentity: string): InvoicingPermissions => ({
  read: `${cubeIdentity}:read`,
  manageCustomers: `${cubeIdentity}:customer.manage`,
  draftInvoices: `${cubeIdentity}:invoice.draft`,
  issueInvoices: `${cubeIdentity}:invoice.issue`,
  issueProformas: `${cubeIdentity}:proforma.issue`,
  voidInvoices: `${cubeIdentity}:invoice.void`,
  manageSettings: `${cubeIdentity}:settings.manage`,
})
