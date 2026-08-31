import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "../api.ts"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { CorrectionPanel } from "../components/CorrectionPanel.tsx"
import { InvoiceDocument } from "../components/InvoiceDocument.tsx"
import { Page } from "../components/Page.tsx"
import { PaymentPanel } from "../components/PaymentPanel.tsx"
import { invoiceActionState } from "../invoice-state.ts"
import { invoicingClient } from "../invoicing-client.ts"

export const InvoiceDetailView = ({ id, notify }: { readonly id: string; readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const bundle = useQuery({ queryKey: ["invoice", id], queryFn: ({ signal }) => runUiEffect(invoicingClient.getInvoiceBundle(id), signal) })
  const remove = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.deleteInvoice(id)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["invoices"] }); notify("Factura a fost ștearsă, iar draftul a fost redeschis."); window.location.hash = "#/invoices" },
  })
  const download = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadInvoicePdf(id)),
    onSuccess: (blob) => {
      if (bundle.data === undefined) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `factura-${bundle.data.invoice.series}-${String(bundle.data.invoice.number)}.pdf`
      link.click()
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
    },
  })
  if (bundle.isPending) return <Loading />
  if (bundle.error !== null) return <Page title="Factură" eyebrow="Document emis"><ErrorAlert error={bundle.error} /></Page>
  const { invoice, paymentSummary, corrections } = bundle.data
  const actionState = invoiceActionState(paymentSummary, corrections)
  const deleteHint = paymentSummary.payments.length > 0 ? "Factura are plăți înregistrate." : corrections.length > 0 ? "Factura are documente de corecție." : undefined
  return <Page title={`Factura ${invoice.series} ${String(invoice.number)}`} eyebrow={`Emisă la ${invoice.issueDate}`} actions={<>
    <button className="button secondary" type="button" onClick={() => { download.mutate() }} disabled={download.isPending}>{download.isPending ? "Se generează…" : "Descarcă PDF"}</button>
    <button className="button danger ghost" type="button" title={deleteHint} disabled={actionState.hasDependentRecords || remove.isPending} onClick={() => { if (window.confirm("Ștergi ultima factură din serie și eliberezi numărul? Operația este permisă doar înainte de trimiterea în RO e-Factura.")) remove.mutate() }}>Șterge factura</button>
  </>}>
    {download.error === null ? null : <ErrorAlert error={download.error} />}
    {remove.error === null ? null : <ErrorAlert error={remove.error} />}
    <InvoiceDocument invoice={invoice} />
    <div className="operations-grid"><PaymentPanel invoiceId={id} currency={invoice.currency} summary={paymentSummary} corrections={corrections} notify={notify} /><CorrectionPanel invoiceId={id} corrections={corrections} paymentSummary={paymentSummary} notify={notify} /></div>
  </Page>
}
