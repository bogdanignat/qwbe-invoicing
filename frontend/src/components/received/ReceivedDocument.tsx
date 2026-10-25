import { StatusNote } from "../ui/StatusNote.tsx"
import { ReceivedLines, ReceivedVat } from "./ReceivedTables.tsx"
import type { ReceivedDocumentView } from "../../lib/received-detail-projection.ts"

/** A read received invoice: its head, the two parties, the lines, VAT by rate, the totals, the notes and the warnings. */
export const ReceivedDocument = ({ view }: { readonly view: ReceivedDocumentView }) => <article className="card document">
  <header className="document-head">
    <h2>{view.heading}</h2>
    <dl className="facts">
      {view.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
  </header>
  {view.warnings.length === 0
    ? null
    : <div className="grid gap-2">{view.warnings.map((warning) => <StatusNote key={warning} warning>{warning}</StatusNote>)}</div>}
  <div className="parties">
    {view.parties.map((party) => <section key={party.heading}>
      <h3>{party.heading}</h3>
      <p className="party-name">{party.name}</p>
      <ul>{party.details.map((detail, index) => <li key={`${String(index)}:${detail}`}>{detail}</li>)}</ul>
    </section>)}
  </div>
  <ReceivedLines lines={view.lines} />
  <ReceivedVat rows={view.vatRows} />
  <dl className="totals">
    {view.totals.map((total) => <div key={total.label}><dt>{total.label}</dt><dd>{total.value}</dd></div>)}
  </dl>
  {view.notes.length === 0
    ? null
    : <section className="document-notes"><h3>Observații</h3>{view.notes.map((note, index) => <p key={`${String(index)}:${note}`}>{note}</p>)}</section>}
</article>
