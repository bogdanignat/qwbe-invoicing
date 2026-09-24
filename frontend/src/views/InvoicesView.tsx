"use client"

import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { InvoiceRegisterTable } from "../components/InvoiceRegisterTable.tsx"
import { LoadMore } from "../components/LoadMore.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { RegisterFilters } from "../components/RegisterFilters.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceRegister } from "../hooks/use-invoice-register.ts"

export const InvoicesView = () => {
  const shell = useAuthenticatedShell()
  const register = useInvoiceRegister()
  return <PrivateScreen shell={shell}>
    <Page title="Registru de facturi" eyebrow="Documente emise">
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {register.rows === undefined
        ? register.isPending
          ? <Loading label="Se încarcă registrul…" />
          : <ErrorAlert error={register.error} onRetry={register.retry} />
        : <section className="card">
          <div className="section-heading">
            <div>
              <h2>Facturi și storno</h2>
              <p>Snapshot-uri fiscale imuabile, ordonate după emitere. Filtrarea se aplică paginilor deja încărcate.</p>
            </div>
            <span className="count">{register.rows.length} / {register.totalLoaded}</span>
          </div>
          {register.error === null ? null : <ErrorAlert error={register.error} onRetry={register.retry} />}
          <RegisterFilters
            filter={register.filter}
            onKindChange={register.setKind}
            onSearchChange={register.setSearch}
          />
          {register.rows.length === 0
            ? <EmptyState>
              {register.totalLoaded === 0
                ? "Nu există încă documente emise."
                : "Niciun document încărcat nu corespunde filtrului."}
            </EmptyState>
            : <InvoiceRegisterTable rows={register.rows} />}
          <LoadMore visible={register.hasMore} pending={register.loadingMore} onClick={register.loadMore} />
        </section>}
    </Page>
  </PrivateScreen>
}
