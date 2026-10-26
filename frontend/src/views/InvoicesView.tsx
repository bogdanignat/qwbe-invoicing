import { AppLink } from "../components/ui/AppLink.tsx"
import { ErrorAlert } from "../components/AsyncState.tsx"
import { DraftsSection } from "../components/DraftsSection.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { RegisterFilters } from "../components/RegisterFilters.tsx"
import { RegisterResults } from "../components/RegisterResults.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useDrafts } from "../hooks/use-drafts.ts"
import { useInvoiceRegister } from "../hooks/use-invoice-register.ts"

export const InvoicesView = () => {
  const shell = useAuthenticatedShell()
  const register = useInvoiceRegister()
  const drafts = useDrafts()
  return <PrivateScreen shell={shell}>
    <Page title="Registru de facturi" eyebrow="Documente emise"
      actions={<AppLink className="button" href="/invoices/new">Factură nouă</AppLink>}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      <div className="section-stack">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Facturi și storno</h2>
              <p>Snapshot-uri fiscale imuabile, ordonate după emitere.</p>
            </div>
            {register.rows === undefined
              ? null
              : <span className="count" aria-live="polite">{register.rows.length} încărcate</span>}
          </div>
          <RegisterFilters filters={register.filters} />
          <RegisterResults register={register} />
        </section>
        <DraftsSection drafts={drafts} />
      </div>
    </Page>
  </PrivateScreen>
}
