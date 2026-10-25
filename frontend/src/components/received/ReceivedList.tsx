import { EmptyState, ErrorAlert, Loading } from "../AsyncState.tsx"
import { LoadMore } from "../LoadMore.tsx"
import { ReceivedTable } from "./ReceivedTable.tsx"
import type { ReceivedInvoicesModel } from "../../hooks/use-received-invoices.ts"

/** The list card: loading, its failure, no invoices yet, or the table with „Încarcă mai multe”. */
export const ReceivedList = ({ list }: { readonly list: ReceivedInvoicesModel }) => {
  if (list.rows === undefined) {
    return list.isPending ? <Loading label="Se încarcă facturile primite…" /> : <ErrorAlert error={list.error} onRetry={list.retry} />
  }
  return <section className="card" aria-labelledby="received-list-title">
    <div className="section-heading">
      <div>
        <h2 id="received-list-title">Preluate din SPV</h2>
        <p>Cele mai noi în SPV mai întâi. O factură necitită are motivul în listă și arhiva ZIP în detaliu.</p>
      </div>
      <span className="count">{list.rows.length}</span>
    </div>
    {list.error === undefined ? null : <ErrorAlert error={list.error} onRetry={list.retry} />}
    {list.rows.length === 0
      ? <EmptyState>Nu există încă facturi primite preluate din SPV.</EmptyState>
      : <ReceivedTable rows={list.rows} />}
    <LoadMore visible={list.hasMore} pending={list.loadingMore} onClick={list.loadMore} />
  </section>
}
