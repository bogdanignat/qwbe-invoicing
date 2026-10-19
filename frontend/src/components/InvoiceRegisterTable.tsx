import { AppLink } from "./ui/AppLink.tsx"
import type { InvoiceRegisterPresentationRow } from "../lib/invoice-register-projection.ts"

interface InvoiceRegisterTableProps {
  readonly rows: ReadonlyArray<InvoiceRegisterPresentationRow>
  /** Whether the e-Factura plugin is on; decided by `useInvoiceRegister`. */
  readonly eFactura: boolean
}

/**
 * Every cell carries `data-label` so the narrow layout can turn the row into a
 * stacked card without a second markup path.
 */
export const InvoiceRegisterTable = ({ rows, eFactura }: InvoiceRegisterTableProps) =>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Registru de facturi și storno</caption>
      <thead>
        <tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th>{eFactura ? <th>e-Factura</th> : null}</tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <td data-label="Număr">
            <AppLink href={row.documentHref}><strong>{row.number}</strong></AppLink>
            {row.kindLabel === null ? null : <small className="badge storno">{row.kindLabel}</small>}
            {row.originalInvoice === null
              ? null
              : <small><AppLink href={row.originalInvoice.href}>{row.originalInvoice.label}</AppLink></small>}
          </td>
          <td data-label="Client">{row.customerName}</td>
          <td data-label="Emisă">{row.issueDate}</td>
          <td data-label="Scadență">{row.dueDate}</td>
          <td data-label="Total" className="numeric">{row.total}</td>
          {eFactura ? <td data-label="e-Factura"><span className="badge">{row.status}</span></td> : null}
        </tr>)}
      </tbody>
    </table>
  </div>
