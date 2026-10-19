import { AppLink } from "../ui/AppLink.tsx"
import type { CollectionRow } from "../../lib/dashboard-situation.ts"

/** The listed invoices with today's status and balance; `data-label` stacks each row on a narrow screen. */
export const CollectionsTable = ({ rows }: { readonly rows: ReadonlyArray<CollectionRow> }) =>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Facturile emise în perioadă, după scadență</caption>
      <thead>
        <tr>
          <th scope="col">Număr</th><th scope="col">Client</th><th scope="col">Emisă</th><th scope="col">Scadență</th>
          <th scope="col" className="numeric">Total</th><th scope="col" className="numeric">Încasat</th>
          <th scope="col" className="numeric">Sold</th><th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.id}>
          <td data-label="Număr"><AppLink href={row.href}><strong>{row.number}</strong></AppLink></td>
          <td data-label="Client">{row.customerName}</td>
          <td data-label="Emisă">{row.issueDate}</td>
          <td data-label="Scadență">{row.dueDate}</td>
          <td data-label="Total" className="numeric">{row.total}</td>
          <td data-label="Încasat" className="numeric">{row.paid}</td>
          <td data-label="Sold" className="numeric">{row.remaining}</td>
          <td data-label="Status"><span className={`badge ${row.statusTone}`}>{row.statusLabel}</span></td>
        </tr>)}
      </tbody>
    </table>
  </div>
