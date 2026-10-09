"use client"

import { CorrectionsSection } from "../components/CorrectionsSection.tsx"
import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PaymentsSection } from "../components/PaymentsSection.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { OperationRecoveryNotice } from "../components/authoring/OperationRecoveryNotice.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceDetail } from "../hooks/use-document-detail.ts"
import { useInvoiceCorrections } from "../hooks/use-invoice-corrections.ts"
import { useInvoicePayments } from "../hooks/use-invoice-payments.ts"

/**
 * An issued invoice, its payments and its storno. The unresolved-write card
 * comes first: a storno whose answer was lost is replayed or acknowledged from
 * here, under the key it left with, rather than issued a second time.
 */
export const InvoiceDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useInvoiceDetail(id)
  const payments = useInvoicePayments(id)
  const corrections = useInvoiceCorrections(id)
  return <PrivateScreen shell={shell}>
    <DocumentDetail title="Factură" eyebrow="Document emis" model={model}>
      <OperationRecoveryNotice
        notice={corrections.notice} pending={corrections.noticePending}
        onReplay={corrections.replay} onDismiss={corrections.dismiss}
      />
      <PaymentsSection payments={payments} />
      <CorrectionsSection corrections={corrections} />
    </DocumentDetail>
  </PrivateScreen>
}
