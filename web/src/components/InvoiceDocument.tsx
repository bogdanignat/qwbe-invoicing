import { money } from "../format.ts"
import type { IssuedInvoice } from "../models.ts"
import { identifierLabel } from "../invoice-authoring-state.ts"

const address = (value: IssuedInvoice["issuer"]["address"]): string => [value.street, value.city, value.county, value.postalCode, value.countryCode].filter((part) => part !== undefined && part !== "").join(", ")

export const InvoiceDocument = ({ invoice }: { readonly invoice: IssuedInvoice }) => <div className="invoice-document card">
  <div className="document-meta"><dl><div><dt>Data emiterii</dt><dd>{invoice.issueDate}</dd></div><div><dt>Data scadenței</dt><dd>{invoice.dueDate}</dd></div><div><dt>Monedă</dt><dd>{invoice.currency}</dd></div></dl></div>
  <div className="invoice-parties"><section><p className="eyebrow">Furnizor</p><h2>{invoice.issuer.legalName}</h2><p>{invoice.issuer.taxIdentifier === "" ? null : <>CUI / CIF: {invoice.issuer.taxIdentifier}<br /></>}{address(invoice.issuer.address)}</p></section><section><p className="eyebrow">Cumpărător · {invoice.customer.partyType === "company" ? "PJ" : "PF"}</p><h2>{invoice.customer.legalName}</h2><p>{invoice.customer.taxIdentifier === "" ? null : <>{identifierLabel(invoice.customer.partyType)}: {invoice.customer.taxIdentifier}<br /></>}{address(invoice.customer.address)}</p></section></div>
  <div className="table-wrap"><table><caption className="sr-only">Linii factură</caption><thead><tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>TVA</th><th>Total</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unitPrice, invoice.currency)}</td><td>{line.taxRate}%</td><td>{money(line.totalIncludingTax, invoice.currency)}</td></tr>)}</tbody></table></div>
  <div className="invoice-bottom"><div className="document-tax-details"><h3>Detaliu TVA</h3>{invoice.taxBreakdown.map((tax) => <p key={`${tax.taxCode}-${tax.rate}`}>{tax.rate}% · bază {money(tax.taxableAmount, invoice.currency)} · TVA {money(tax.taxAmount, invoice.currency)}</p>)}</div><dl><div><dt>Subtotal</dt><dd>{money(invoice.totalExcludingTax, invoice.currency)}</dd></div><div><dt>TVA</dt><dd>{money(invoice.taxTotal, invoice.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(invoice.totalIncludingTax, invoice.currency)}</dd></div></dl></div>
</div>
