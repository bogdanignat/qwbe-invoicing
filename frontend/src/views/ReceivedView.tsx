import { ErrorAlert } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ReceivedFetchPanel } from "../components/received/ReceivedFetchPanel.tsx"
import { ReceivedList } from "../components/received/ReceivedList.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useReceivedFetch } from "../hooks/use-received-fetch.ts"
import { useReceivedInvoices } from "../hooks/use-received-invoices.ts"

/** Facturi primite: the fetch from the SPV and the list it fills; with e-Factura off the screen says so and asks nothing. */
export const ReceivedView = () => {
  const shell = useAuthenticatedShell()
  const fetch = useReceivedFetch()
  const list = useReceivedInvoices()
  return <PrivateScreen shell={shell}>
    <Page title="Facturi primite" eyebrow="e-Factura">
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {fetch === undefined || list === undefined
        ? <p className="setup-note">Această instalare nu are pornit pluginul e-Factura, deci nu preia facturi primite.</p>
        : <div className="section-stack">
          <ReceivedFetchPanel model={fetch} />
          <ReceivedList list={list} />
        </div>}
    </Page>
  </PrivateScreen>
}
