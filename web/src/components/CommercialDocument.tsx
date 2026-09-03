import { money } from "../format.ts"
import { identifierLabel } from "../invoice-authoring-state.ts"
import type { Proforma } from "../models.ts"

type CommercialDocumentSnapshot = Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "taxBreakdown" | "totalExcludingTax" | "taxTotal" | "totalIncludingTax">

interface CommercialDocumentProps {
  readonly snapshot: CommercialDocumentSnapshot
  readonly heading?: string
  readonly notice?: string
  readonly lineCaption: string
}

const address = (value: CommercialDocumentSnapshot["issuer"]["address"]): string =>
  [value.street, value.city, value.county, value.postalCode, value.countryCode].filter((part) => part !== undefined && part !== "").join(", ")

export const CommercialDocument = ({ snapshot, heading, notice, lineCaption }: CommercialDocumentProps) => <div className="invoice-document card">
  {heading === undefined ? null : <header><p className="eyebrow">{notice}</p><h2>{heading}</h2></header>}
  <div className="document-meta"><dl><div><dt>Data emiterii</dt><dd>{snapshot.issueDate}</dd></div><div><dt>Data scadenței</dt><dd>{snapshot.dueDate ?? "—"}</dd></div><div><dt>Monedă</dt><dd>{snapshot.currency}</dd></div></dl></div>
  <div className="invoice-parties"><section><p className="eyebrow">Furnizor</p><h2>{snapshot.issuer.legalName}</h2><p>{snapshot.issuer.taxIdentifier === "" ? null : <>CUI / CIF: {snapshot.issuer.taxIdentifier}<br /></>}{address(snapshot.issuer.address)}</p></section><section><p className="eyebrow">Cumpărător · {snapshot.customer.partyType === "company" ? "PJ" : "PF"}</p><h2>{snapshot.customer.legalName}</h2><p>{snapshot.customer.taxIdentifier === "" ? null : <>{identifierLabel(snapshot.customer.partyType)}: {snapshot.customer.taxIdentifier}<br /></>}{address(snapshot.customer.address)}</p></section></div>
  <div className="table-wrap"><table><caption className="sr-only">{lineCaption}</caption><thead><tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>TVA</th><th>Total</th></tr></thead><tbody>{snapshot.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unitPrice, snapshot.currency)}</td><td>{line.taxRate}%</td><td>{money(line.totalIncludingTax, snapshot.currency)}</td></tr>)}</tbody></table></div>
  <div className="invoice-bottom"><div className="document-tax-details"><h3>Detaliu TVA</h3>{snapshot.taxBreakdown.map((tax) => <p key={`${tax.taxCode}-${tax.rate}`}>{tax.rate}% · bază {money(tax.taxableAmount, snapshot.currency)} · TVA {money(tax.taxAmount, snapshot.currency)}</p>)}</div><dl><div><dt>Subtotal</dt><dd>{money(snapshot.totalExcludingTax, snapshot.currency)}</dd></div><div><dt>TVA</dt><dd>{money(snapshot.taxTotal, snapshot.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(snapshot.totalIncludingTax, snapshot.currency)}</dd></div></dl></div>
</div>
