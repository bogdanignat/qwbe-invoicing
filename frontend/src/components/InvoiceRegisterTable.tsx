import Link from "next/link"

import type { InvoiceRegisterPresentationRow } from "../lib/invoice-register-projection.ts"

/**
 * Every cell carries `data-label` so the narrow layout can turn the row into a
 * stacked card without a second markup path.
 */
export const InvoiceRegisterTable = ({ rows }: { readonly rows: ReadonlyArray<InvoiceRegisterPresentationRow> }) =>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Registru de facturi și storno</caption>
      <thead>
        <tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>e-Factura</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <td data-label="Număr">
            <Link href={row.documentHref}><strong>{row.number}</strong></Link>
            {row.kindLabel === null ? null : <small className="badge storno">{row.kindLabel}</small>}
            {row.originalInvoice === null
              ? null
              : <small><Link href={row.originalInvoice.href}>{row.originalInvoice.label}</Link></small>}
          </td>
          <td data-label="Client">{row.customerName}</td>
          <td data-label="Emisă">{row.issueDate}</td>
          <td data-label="Scadență">{row.dueDate}</td>
          <td data-label="Total" className="numeric">{row.total}</td>
          <td data-label="e-Factura"><span className="badge">{row.status}</span></td>
        </tr>)}
      </tbody>
    </table>
  </div>
