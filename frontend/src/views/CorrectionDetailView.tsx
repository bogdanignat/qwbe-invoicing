"use client"

import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useCorrectionDetail } from "../hooks/use-document-detail.ts"

export const CorrectionDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useCorrectionDetail(id)
  return <PrivateScreen shell={shell}>
    <DocumentDetail title="Storno" eyebrow="Document emis" model={model} />
  </PrivateScreen>
}
