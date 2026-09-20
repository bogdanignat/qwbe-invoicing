import { ErrorAlert, Loading } from "../components/layout/AsyncState.tsx"
import { CorrectionPanel } from "../components/invoice/CorrectionPanel.tsx"
import { InvoiceDocument } from "../components/document/InvoiceDocument.tsx"
import { Page } from "../components/layout/Page.tsx"
import { PaymentPanel } from "../components/invoice/PaymentPanel.tsx"
import { Button } from "../components/ui/Button.tsx"
import { useInvoiceDetail } from "../hooks/invoices-hooks.ts"

export const InvoiceDetailView = ({ id, notify }: { readonly id: string; readonly notify: (message: string) => void }) => {
  const state = useInvoiceDetail(id)
  if (state.bundle.data === undefined && state.bundle.isPending) return <Loading />
  if (state.bundle.data === undefined) return <Page title="Factură" eyebrow="Document emis"><ErrorAlert error={state.bundle.error} /></Page>
  const { invoice, paymentSummary, corrections } = state.bundle.data
  return <Page title="Factură" eyebrow="Document emis" actions={<>
    <Button variant="secondary" onClick={() => { state.download.start() }} disabled={state.download.pending}>{state.download.pending ? "Se generează…" : "Descarcă PDF"}</Button>
    <Button variant="secondary" onClick={() => { state.efactura.start() }} disabled={state.efactura.pending}>{state.efactura.pending ? "Se generează…" : "Descarcă XML e-Factura"}</Button>
  </>}>
    {state.bundle.error === null ? null : <ErrorAlert error={state.bundle.error} />}
    {state.download.error === null ? null : <ErrorAlert error={state.download.error} />}
    {state.efactura.error === null ? null : <ErrorAlert error={state.efactura.error} />}
    <InvoiceDocument invoice={invoice} />
    <div className="operations-grid"><PaymentPanel invoiceId={id} currency={invoice.currency} summary={paymentSummary} corrections={corrections} notify={notify} /><CorrectionPanel invoiceId={id} corrections={corrections} paymentSummary={paymentSummary} notify={notify} /></div>
  </Page>
}
