import { Button } from "../Button.tsx"
import type { EFacturaDocumentModel } from "../../hooks/use-efactura-document.ts"

export const EFACTURA_REASON_ID = "efactura-reason"

/**
 * The document head's e-Factura button, in place of the former XML export.
 * It submits only when the panel allows it; otherwise it states where the
 * document is, and the sentence under the panel's heading says why.
 */
export const EFacturaAction = ({ model }: { readonly model: EFacturaDocumentModel }) => {
  const { view } = model
  if (view === undefined) return null
  const label = model.pending && view.canSubmit ? "Se trimite…" : view.buttonLabel
  return <Button disabled={!view.canSubmit || model.pending} onClick={model.submit}
    aria-describedby={view.canSubmit ? undefined : EFACTURA_REASON_ID}>{label}</Button>
}
