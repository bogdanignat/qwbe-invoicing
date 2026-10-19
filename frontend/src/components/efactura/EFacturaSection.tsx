import { ErrorAlert } from "../AsyncState.tsx"
import { StatusNote } from "../ui/StatusNote.tsx"
import { EFACTURA_REASON_ID } from "./EFacturaAction.tsx"
import { EFacturaErrors } from "./EFacturaErrors.tsx"
import { EFacturaFiles } from "./EFacturaFiles.tsx"
import { EFacturaHistory } from "./EFacturaHistory.tsx"
import { EFacturaReconciliation } from "./EFacturaReconciliation.tsx"
import type { EFacturaDocumentModel } from "../../hooks/use-efactura-document.ts"
import { useFocusOnReturn } from "../../hooks/use-focus-on-return.ts"

/**
 * A document's e-Factura panel: where it is at ANAF and why, ANAF's errors on
 * the current submission, the reconciliation of an `unknown` one, and every
 * submission so far. The send button itself is in the document head. A
 * settled link or resubmit removes the reconciliation it was pressed in, so the
 * keyboard goes back to the panel's heading instead of `document.body`.
 */
export const EFacturaSection = ({ model }: { readonly model: EFacturaDocumentModel }) => {
  const { view } = model
  const heading = useFocusOnReturn<HTMLHeadingElement>(view?.reconcile !== true, true)
  return <section className="card grid gap-4" aria-labelledby="efactura-section-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">ANAF</p>
        <h2 id="efactura-section-title" ref={heading} tabIndex={-1}>e-Factura</h2>
      </div>
      {view === undefined ? null : <span className={view.badgeClass}>{view.badgeLabel}</span>}
    </div>
    {view === undefined
      ? model.isPending ? <p className="hint" role="status">Se încarcă starea e-Factura…</p> : <ErrorAlert error={model.error} onRetry={model.retry} />
      : <>
        {view.reason === undefined ? null : <p id={EFACTURA_REASON_ID} className="m-0">{view.reason}</p>}
        {view.detail === undefined ? null : <p className="m-0">{view.detail}</p>}
        {model.connectionError === undefined ? null : <ErrorAlert error={model.connectionError} onRetry={model.connectionRetry} />}
        {view.current === null
          ? null
          : <EFacturaFiles submissionId={view.current.id} files={model.files} response={view.responseStored} />}
        {model.notice === undefined ? null : <StatusNote>{model.notice}</StatusNote>}
        {model.failure === undefined ? null : <ErrorAlert error={model.failure} />}
        <EFacturaErrors errors={view.errors} title={view.errorsTitle} />
        {view.reconcile ? <EFacturaReconciliation model={model.reconciliation} /> : null}
        <EFacturaHistory rows={model.rows} files={model.files} />
      </>}
  </section>
}
