"use client"

import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PaymentsSection } from "../components/PaymentsSection.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceDetail } from "../hooks/use-document-detail.ts"
import { useInvoicePayments } from "../hooks/use-invoice-payments.ts"

export const InvoiceDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useInvoiceDetail(id)
  const payments = useInvoicePayments(id)
  return <PrivateScreen shell={shell}>
    <DocumentDetail title="Factură" eyebrow="Document emis" model={model}>
      <PaymentsSection payments={payments} />
    </DocumentDetail>
  </PrivateScreen>
}
