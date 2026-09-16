import { money } from "../format.ts"
import { buyerFiscalIdentity, formattedRomanianAddress } from "../fiscal-identity.ts"
import type { Proforma } from "../models.ts"
import { DocumentHeader } from "./DocumentHeader.tsx"
import { IssuerDetails } from "./IssuerDetails.tsx"

type CommercialDocumentSnapshot = Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">

interface CommercialDocumentProps {
  readonly snapshot: CommercialDocumentSnapshot
  readonly identity: {
    readonly kind: "invoice" | "proforma"
    readonly series: string
    readonly number: number
  }
  readonly lineCaption: string
}

export const CommercialDocument = ({ snapshot, identity, lineCaption }: CommercialDocumentProps) => {
  const buyerIdentity = buyerFiscalIdentity(snapshot.customer)
  return <div className="invoice-document card">
  <DocumentHeader
    identity={<section className="document-identity">
      <h2>{identity.kind === "invoice" ? "FACTURĂ" : "PROFORMĂ"}</h2>
      {identity.kind === "proforma" ? <p className="document-non-fiscal">DOCUMENT NEFISCAL</p> : null}
      <p className="document-number"><span className="sr-only">Număr {identity.kind === "invoice" ? "factură" : "proformă"} </span>{identity.series} {String(identity.number)}</p>
      <dl className="document-dates"><div><dt>Data emiterii</dt><dd>{snapshot.issueDate}</dd></div>{snapshot.dueDate === null ? null : <div><dt>Scadență</dt><dd>{snapshot.dueDate}</dd></div>}<div><dt>Monedă</dt><dd>{snapshot.currency}</dd></div></dl>
    </section>}
    issuer={<section className="document-party"><p className="eyebrow">Furnizor</p><IssuerDetails issuer={snapshot.issuer} /></section>}
    customer={<section className="document-party"><p className="eyebrow">Client · {snapshot.customer.partyType === "company" ? "PJ" : "PF"}</p><h2>{snapshot.customer.name}</h2><p className="document-party-details">{buyerIdentity.fiscalIdentifier === "" ? null : <>{buyerIdentity.identifierLabel}: {buyerIdentity.fiscalIdentifier}<br /></>}{buyerIdentity.vatIdentifier === null ? null : <>Cod TVA: {buyerIdentity.vatIdentifier}<br /></>}<span className="document-address">{formattedRomanianAddress(snapshot.customer.address)}</span></p></section>}
  />
  <div className="table-wrap"><table><caption className="sr-only">{lineCaption}</caption><thead><tr><th>Descriere</th><th>Cantitate</th><th>U.M.</th><th>Preț unitar</th><th>TVA</th><th>Total</th></tr></thead><tbody>{snapshot.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{line.unitOfMeasure.name} — {line.unitOfMeasure.code}</td><td>{money(line.unitPrice, snapshot.currency)}</td><td>{line.vatRate}%</td><td>{money(line.totalIncludingVat, snapshot.currency)}</td></tr>)}</tbody></table></div>
  <div className="invoice-bottom"><div className="document-tax-details"><h3>Detaliu TVA</h3>{snapshot.vatBreakdown.map((tax) => <p key={`${tax.code}-${tax.rate}`}>{tax.rate}% · bază {money(tax.vatBaseAmount, snapshot.currency)} · TVA {money(tax.vatAmount, snapshot.currency)}</p>)}</div><dl><div><dt>Subtotal</dt><dd>{money(snapshot.totalExcludingVat, snapshot.currency)}</dd></div><div><dt>TVA</dt><dd>{money(snapshot.vatTotal, snapshot.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(snapshot.totalIncludingVat, snapshot.currency)}</dd></div></dl></div>
  {snapshot.notes === null ? null : <section className="document-notes"><p className="eyebrow">Observații</p><p className="document-notes-body">{snapshot.notes}</p></section>}
</div>
}
