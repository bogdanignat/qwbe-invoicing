import type { IssuedInvoice } from "../../lib/models.ts"
import { CommercialDocument } from "./CommercialDocument.tsx"

export const InvoiceDocument = ({ invoice }: { readonly invoice: IssuedInvoice }) => <CommercialDocument snapshot={invoice} identity={{ kind: "invoice", series: invoice.series, number: invoice.number }} lineCaption="Linii factură" />
