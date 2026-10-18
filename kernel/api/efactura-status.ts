import type { Schema } from "effect"

import type { InvoiceRegisterRow, IssuedInvoice, IssuedInvoiceSummary, Page } from "../../cubes/invoicing/index.ts"
import type { InvoiceRegisterPage } from "./schema-invoice-register.ts"
import type { IssuedInvoice as IssuedInvoiceResponse, IssuedInvoicePage } from "./schema-issuance.ts"

/**
 * What an invoice response says about e-Factura. With the plugin off there is
 * no XML and no transmission, so the status is `null` everywhere an invoice is
 * returned: register, list, detail, issuance and conversion. The field stays in
 * the response, the stored snapshot is not touched, and nothing fiscal reads
 * this projection.
 */
export interface EFacturaStatusView {
  readonly invoice: (invoice: IssuedInvoice) => Schema.Schema.Type<typeof IssuedInvoiceResponse>
  readonly invoices: (page: Page<IssuedInvoiceSummary>) => Schema.Schema.Type<typeof IssuedInvoicePage>
  readonly register: (page: Page<InvoiceRegisterRow>) => Schema.Schema.Type<typeof InvoiceRegisterPage>
}

export const eFacturaStatusView = (active: boolean): EFacturaStatusView => active
  ? { invoice: (invoice) => invoice, invoices: (page) => page, register: (page) => page }
  : {
    invoice: (invoice) => ({ ...invoice, eFacturaStatus: null }),
    invoices: (page) => ({ ...page, items: page.items.map((invoice) => ({ ...invoice, eFacturaStatus: null })) }),
    register: (page) => ({ ...page, items: page.items.map((row) => ({ ...row, eFacturaStatus: null })) }),
  }
