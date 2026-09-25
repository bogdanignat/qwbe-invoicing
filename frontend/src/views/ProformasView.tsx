"use client"

import Link from "next/link"

import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { LoadMore } from "../components/LoadMore.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ProformaRegisterTable } from "../components/ProformaRegisterTable.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useProformas } from "../hooks/use-proformas.ts"

/**
 * The proforma registry, with the same state split as the invoice register: a
 * first read that has not answered shows the loader, one that failed shows the
 * error with a retry only where asking again could answer differently, and a
 * later page failing keeps the rows already on screen.
 */
export const ProformasView = () => {
  const shell = useAuthenticatedShell()
  const proformas = useProformas()
  return <PrivateScreen shell={shell}>
    <Page title="Proforme" eyebrow="Documente comerciale"
      actions={<Link className="button" href="/proformas/new">Proformă nouă</Link>}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {proformas.rows === undefined
        ? proformas.isPending
          ? <Loading label="Se încarcă proformele…" />
          : <ErrorAlert error={proformas.error} onRetry={proformas.retry} />
        : <section className="card">
          <div className="section-heading">
            <div>
              <h2>Registru de proforme</h2>
              <p>Documente comerciale nefiscale, ordonate după emitere. O proformă poate deveni factură sau draft de factură, o singură dată.</p>
            </div>
            <span className="count">{proformas.rows.length}</span>
          </div>
          {proformas.error === null ? null : <ErrorAlert error={proformas.error} onRetry={proformas.retry} />}
          {proformas.rows.length === 0
            ? <EmptyState>Nu există încă proforme emise.</EmptyState>
            : <ProformaRegisterTable rows={proformas.rows} />}
          <LoadMore visible={proformas.hasMore} pending={proformas.loadingMore} onClick={proformas.loadMore} />
        </section>}
    </Page>
  </PrivateScreen>
}
