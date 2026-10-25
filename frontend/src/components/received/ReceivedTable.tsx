import { AppLink } from "../ui/AppLink.tsx"
import type { ReceivedRow } from "../../lib/received-projection.ts"

/**
 * The received invoices, newest first in the SPV. Every cell carries
 * `data-label` so the narrow layout stacks the row into a card.
 */
export const ReceivedTable = ({ rows }: { readonly rows: ReadonlyArray<ReceivedRow> }) =>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Facturi primite din SPV</caption>
      <thead>
        <tr>
          <th>Număr</th><th>Furnizor</th><th>CIF</th><th>Data</th><th>Scadență</th>
          <th>Total</th><th>TVA</th><th>Monedă</th><th>Citire</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <td data-label="Număr">
            <AppLink href={row.href} aria-label={row.linkName}><strong>{row.label}</strong></AppLink>
            {row.kindLabel === null ? null : <small className="badge storno">{row.kindLabel}</small>}
          </td>
          <td data-label="Furnizor">{row.supplierName}</td>
          <td data-label="CIF">{row.supplierCif}</td>
          <td data-label="Data">{row.issueDate}</td>
          <td data-label="Scadență">{row.dueDate}</td>
          <td data-label="Total" className="numeric">{row.total}</td>
          <td data-label="TVA" className="numeric">{row.vat}</td>
          <td data-label="Monedă">{row.currency}</td>
          <td data-label="Citire">
            <span className={row.readable ? "badge positive" : "badge text-invoice-danger-text"}>{row.readLabel}</span>
            {row.notes.map((note) => <small key={note} className="block">{note}</small>)}
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>
