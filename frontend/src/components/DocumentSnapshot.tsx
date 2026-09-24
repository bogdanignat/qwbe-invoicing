import Link from "next/link"

import type { DocumentSnapshotView } from "../lib/document-projection.ts"

export const DocumentSnapshot = ({ view }: { readonly view: DocumentSnapshotView }) => <article className="card document">
  <header className="document-head">
    <h2>{view.heading}</h2>
    <dl className="facts">
      {view.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
  </header>
  {view.originalInvoice === null
    ? null
    : <p className="document-origin"><Link href={view.originalInvoice.href}>{view.originalInvoice.label}</Link></p>}
  <div className="parties">
    {view.parties.map((party) => <section key={party.heading}>
      <h3>{party.heading}</h3>
      <p className="party-name">{party.name}</p>
      <ul>{party.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
    </section>)}
  </div>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Linii document</caption>
      <thead>
        <tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>Cotă TVA</th><th>Fără TVA</th><th>Valoare TVA</th><th>Cu TVA</th></tr>
      </thead>
      <tbody>
        {view.lines.map((line) => <tr key={line.key}>
          <td data-label="Descriere">{line.description}</td>
          <td data-label="Cantitate">{line.quantity}</td>
          <td data-label="Preț unitar" className="numeric">{line.unitPrice}</td>
          <td data-label="Cotă TVA">{line.vat}</td>
          <td data-label="Fără TVA" className="numeric">{line.totalExcludingVat}</td>
          <td data-label="Valoare TVA" className="numeric">{line.vatAmount}</td>
          <td data-label="Cu TVA" className="numeric">{line.totalIncludingVat}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
  <div className="table-wrap">
    <table>
      <caption className="sr-only">Defalcare TVA</caption>
      <thead><tr><th>Tratament TVA</th><th>Bază</th><th>Valoare TVA</th><th>Motiv scutire</th></tr></thead>
      <tbody>
        {view.vatRows.map((row) => <tr key={row.key}>
          <td data-label="Tratament TVA">{row.rate}</td>
          <td data-label="Bază" className="numeric">{row.base}</td>
          <td data-label="Valoare TVA" className="numeric">{row.amount}</td>
          <td data-label="Motiv scutire">{row.note}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
  <dl className="totals">
    {view.totals.map((total) => <div key={total.label}><dt>{total.label}</dt><dd>{total.value}</dd></div>)}
  </dl>
  {view.notes === null ? null : <section className="document-notes"><h3>Observații</h3><p>{view.notes}</p></section>}
</article>
