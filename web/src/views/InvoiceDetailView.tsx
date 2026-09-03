import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { CorrectionPanel } from "../components/CorrectionPanel.tsx"
import { InvoiceDocument } from "../components/InvoiceDocument.tsx"
import { Page } from "../components/Page.tsx"
import { PaymentPanel } from "../components/PaymentPanel.tsx"
import { useInvoiceDetail } from "../invoices-hooks.ts"

export const InvoiceDetailView = ({ id, notify }: { readonly id: string; readonly notify: (message: string) => void }) => {
  const state = useInvoiceDetail(id)
  if (state.bundle.data === undefined && state.bundle.isPending) return <Loading />
  if (state.bundle.data === undefined) return <Page title="Factură" eyebrow="Document emis"><ErrorAlert error={state.bundle.error} /></Page>
  const { invoice, paymentSummary, corrections } = state.bundle.data
  return <Page title={`Factura ${invoice.series} ${String(invoice.number)}`} eyebrow={`Emisă la ${invoice.issueDate}`} actions={<>
    <button className="button secondary" type="button" onClick={() => { state.download.start() }} disabled={state.download.pending}>{state.download.pending ? "Se generează…" : "Descarcă PDF"}</button>
  </>}>
    {state.bundle.error === null ? null : <ErrorAlert error={state.bundle.error} />}
    {state.download.error === null ? null : <ErrorAlert error={state.download.error} />}
    <InvoiceDocument invoice={invoice} />
    <div className="operations-grid"><PaymentPanel invoiceId={id} currency={invoice.currency} summary={paymentSummary} corrections={corrections} notify={notify} /><CorrectionPanel invoiceId={id} corrections={corrections} paymentSummary={paymentSummary} notify={notify} /></div>
  </Page>
}
