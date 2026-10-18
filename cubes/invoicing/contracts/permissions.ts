/** A record of permission names, declared as a type alias rather than an
 * interface so it keeps an implicit index signature: the cube manifest reads
 * the whole set with `Object.values` instead of restating it. */
export type InvoicingPermissions = {
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
