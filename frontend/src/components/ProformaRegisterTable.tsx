import Link from "next/link"

import type { ProformaRegisterRow } from "../lib/proforma-projection.ts"

/**
 * Every cell carries `data-label`, as the invoice register's does, so the narrow
 * layout can stack the row without a second markup path. The tone class comes
 * from the projection: the list and the document must not describe the same
 * proforma differently.
 */
export const ProformaRegisterTable = ({ rows }: { readonly rows: ReadonlyArray<ProformaRegisterRow> }) =>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Registru de proforme</caption>
      <thead>
        <tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <td data-label="Număr"><Link href={row.documentHref}><strong>{row.number}</strong></Link></td>
          <td data-label="Client">{row.customerName}</td>
          <td data-label="Emisă">{row.issueDate}</td>
          <td data-label="Scadență">{row.dueDate}</td>
          <td data-label="Total" className="numeric">{row.total}</td>
          <td data-label="Status"><span className={`badge ${row.status.tone}`}>{row.status.label}</span></td>
        </tr>)}
      </tbody>
    </table>
  </div>
