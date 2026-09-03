import type { IssuedInvoice } from "../models.ts"
import { CommercialDocument } from "./CommercialDocument.tsx"

export const InvoiceDocument = ({ invoice }: { readonly invoice: IssuedInvoice }) => <CommercialDocument snapshot={invoice} lineCaption="Linii factură" />
