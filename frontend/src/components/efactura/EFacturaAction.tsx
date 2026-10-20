import { Button } from "../Button.tsx"
import type { EFacturaDocumentModel } from "../../hooks/use-efactura-document.ts"

export const EFACTURA_REASON_ID = "efactura-reason"

/**
 * The document head's e-Factura button, in place of the former XML export.
 * It submits only when the panel allows it; otherwise it states where the
 * document is, and the sentence under the panel's heading says why. Once ANAF
 * registered the document there is nothing left to press, so it is a status.
 */
export const EFacturaAction = ({ model }: { readonly model: EFacturaDocumentModel }) => {
  const { view } = model
  if (view === undefined) return null
  if (view.registered) return <Registered label={view.buttonLabel} />
  const label = model.pending && view.canSubmit ? "Se trimite…" : view.buttonLabel
  return <Button disabled={!view.canSubmit || model.pending} onClick={model.submit}
    aria-describedby={view.canSubmit ? undefined : EFACTURA_REASON_ID}>{label}</Button>
}

const Registered = ({ label }: { readonly label: string }) =>
  <span className="inline-flex min-h-[2.55rem] items-center gap-2 rounded-invoice-control border border-invoice-focus bg-invoice-primary-soft px-4 font-[750] text-invoice-primary">
    <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3.25 3.25L13 5" /></svg>
    {label}
  </span>
