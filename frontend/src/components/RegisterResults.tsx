import { EmptyState, ErrorAlert, Loading } from "./AsyncState.tsx"
import { InvoiceRegisterTable } from "./InvoiceRegisterTable.tsx"
import { LoadMore } from "./LoadMore.tsx"
import type { InvoiceRegisterModel } from "../hooks/use-invoice-register.ts"

/**
 * What the server answered for the current filters. The filters live outside
 * this component, so a loading state or a failure never takes them (or the
 * focus in the search field) off the screen.
 */
export const RegisterResults = ({ register }: { readonly register: InvoiceRegisterModel }) => {
  if (register.rows === undefined) {
    return register.isPending
      ? <Loading label="Se încarcă registrul…" />
      : <ErrorAlert error={register.error} onRetry={register.retry} />
  }
  return <div aria-busy={register.refreshing} className={register.refreshing ? "opacity-60 transition-opacity" : undefined}>
    {register.error === null ? null : <ErrorAlert error={register.error} onRetry={register.retry} />}
    {register.rows.length === 0
      ? <EmptyState>
        {register.filters.narrowed ? "Niciun document nu corespunde filtrelor." : "Nu există încă documente emise."}
      </EmptyState>
      : <InvoiceRegisterTable rows={register.rows} eFactura={register.eFacturaColumn} />}
    <LoadMore visible={register.hasMore} pending={register.loadingMore} onClick={register.loadMore} />
  </div>
}
