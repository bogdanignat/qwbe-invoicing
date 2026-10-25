import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { DocumentDownloads } from "../components/DocumentDownloads.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ReceivedDocument } from "../components/received/ReceivedDocument.tsx"
import { AppLink } from "../components/ui/AppLink.tsx"
import { StatusNote } from "../components/ui/StatusNote.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useReceivedDetail, type ReceivedDetailModel } from "../hooks/use-received-detail.ts"

const ReceivedBody = ({ model }: { readonly model: ReceivedDetailModel }) => {
  if (model.view !== undefined) return <ReceivedDocument view={model.view} />
  if (model.unreadable !== undefined) {
    return <StatusNote warning>Factura nu a putut fi citită: {model.unreadable} Poți descărca arhiva ZIP exact cum a trimis-o ANAF.</StatusNote>
  }
  return model.isPending ? <Loading label="Se încarcă factura primită…" /> : <ErrorAlert error={model.error} onRetry={model.retry} />
}

/** One received invoice and „Descarcă ZIP”, read or not; with e-Factura off the screen says so and asks nothing. */
export const ReceivedDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const model = useReceivedDetail(id)
  return <PrivateScreen shell={shell}>
    <Page title="Factură primită" eyebrow="e-Factura"
      actions={model?.loaded === true ? <DocumentDownloads actions={[model.archive]} /> : undefined}>
      <p className="back-link"><AppLink href="/received">← Înapoi la facturile primite</AppLink></p>
      {model === undefined
        ? <p className="setup-note">Această instalare nu are pornit pluginul e-Factura.</p>
        : <>
          {model.archive.error === null ? null : <ErrorAlert error={model.archive.error} />}
          <ReceivedBody model={model} />
        </>}
    </Page>
  </PrivateScreen>
}
