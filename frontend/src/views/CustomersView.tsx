"use client"

import { CustomerEditorSection } from "../components/registry/CustomerEditorSection.tsx"
import { CustomersRegistrySection } from "../components/registry/CustomersRegistrySection.tsx"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Button } from "../components/Button.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useCustomerRegistry } from "../hooks/use-customer-registry.ts"

/**
 * The customer registry, split like the legacy screen: the saved parties on the
 * left, the editor on the right, and the keyboard following the record that
 * opens — a move the editor itself performs, since it owns the heading.
 */
export const CustomersView = () => {
  const shell = useAuthenticatedShell()
  const registry = useCustomerRegistry()
  const { load } = registry
  return <PrivateScreen shell={shell}>
    <Page title="Clienți" eyebrow="Registru"
      actions={load.kind === "ready"
        ? <Button onClick={registry.startCreate} disabled={registry.pending}>Client nou</Button>
        : undefined}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {load.kind === "loading" ? <Loading label="Se încarcă clienții…" /> : null}
      {load.kind === "error" ? <ErrorAlert error={load.error} onRetry={registry.retry} /> : null}
      {load.kind === "ready"
        ? <>
          {registry.notice === undefined ? null : <p className="status-note" role="status">{registry.notice}</p>}
          {registry.editing === undefined && registry.error !== null && registry.error !== undefined
            ? <ErrorAlert error={registry.error} />
            : null}
          <div className="authoring-layout">
            <CustomersRegistrySection customers={registry.customers} editingId={registry.editing?.id}
              disabled={registry.pending} hasMore={registry.hasMore} loadingMore={registry.loadingMore}
              onLoadMore={registry.loadMore} onEdit={registry.startEdit} onDelete={registry.remove} />
            <div className="authoring-side">
              {registry.form === undefined
                ? <section className="card"><p className="setup-note">Alege un client din listă ca să îl modifici, sau adaugă unul nou.</p></section>
                : <CustomerEditorSection form={registry.form} editingId={registry.editing?.id}
                  sectorRequired={registry.sectorRequired} issue={registry.issue} pending={registry.pending}
                  error={registry.error} onChange={registry.change}
                  onPartyTypeChange={registry.changePartyType} onIdentifierChange={registry.changeIdentifier}
                  onCountyChange={registry.changeCounty} onSubmit={registry.submit} onClose={registry.close} />}
            </div>
          </div>
        </>
        : null}
    </Page>
  </PrivateScreen>
}
