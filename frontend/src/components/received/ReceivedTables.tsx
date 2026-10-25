import type { LineView, VatRowView } from "../../lib/received-detail-projection.ts"

/** The lines as the XML gives them: quantity and unit price at the precision it wrote. */
export const ReceivedLines = ({ lines }: { readonly lines: ReadonlyArray<LineView> }) => <div className="table-wrap">
  <table>
    <caption className="sr-only">Linii factură primită</caption>
    <thead><tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>TVA</th><th>Valoare fără TVA</th></tr></thead>
    <tbody>
      {lines.map((line) => <tr key={line.key}>
        <td data-label="Descriere">{line.description}</td>
        <td data-label="Cantitate" className="numeric">{line.quantity}</td>
        <td data-label="Preț unitar" className="numeric">{line.unitPrice}</td>
        <td data-label="TVA">{line.vat}</td>
        <td data-label="Valoare fără TVA" className="numeric">{line.net}</td>
      </tr>)}
    </tbody>
  </table>
</div>

/** VAT by category and rate, as the document declares it. */
export const ReceivedVat = ({ rows }: { readonly rows: ReadonlyArray<VatRowView> }) => <div className="table-wrap">
  <table>
    <caption className="sr-only">TVA pe cote</caption>
    <thead><tr><th>Categorie și cotă</th><th>Bază</th><th>Valoare TVA</th><th>Motiv scutire</th></tr></thead>
    <tbody>
      {rows.map((row) => <tr key={row.key}>
        <td data-label="Categorie și cotă">{row.rate}</td>
        <td data-label="Bază" className="numeric">{row.base}</td>
        <td data-label="Valoare TVA" className="numeric">{row.amount}</td>
        <td data-label="Motiv scutire">{row.note}</td>
      </tr>)}
    </tbody>
  </table>
</div>
