import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { EFacturaAction } from "../components/efactura/EFacturaAction.tsx"
import { EFacturaSection } from "../components/efactura/EFacturaSection.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useCorrectionDetail } from "../hooks/use-document-detail.ts"
import { useEFacturaDocument } from "../hooks/use-efactura-document.ts"

/** A storno and, with the e-Factura plugin on, its submission to ANAF. */
export const CorrectionDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useCorrectionDetail(id)
  const eFactura = useEFacturaDocument("correction", id, model.reference)
  return <PrivateScreen shell={shell}>
    <DocumentDetail title="Factură storno" eyebrow="Document emis" model={model}
      action={eFactura === undefined ? undefined : <EFacturaAction model={eFactura} />}>
      {eFactura === undefined ? null : <EFacturaSection model={eFactura} />}
    </DocumentDetail>
  </PrivateScreen>
}
