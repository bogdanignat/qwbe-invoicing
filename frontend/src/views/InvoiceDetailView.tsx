"use client"

import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceDetail } from "../hooks/use-document-detail.ts"

export const InvoiceDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useInvoiceDetail(id)
  return <PrivateScreen shell={shell}>
    <DocumentDetail title="Factură" eyebrow="Document emis" model={model} />
  </PrivateScreen>
}
