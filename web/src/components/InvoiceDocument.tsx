import { money } from "../format.ts"
import type { IssuedInvoice } from "../models.ts"

export const InvoiceDocument = ({ invoice }: { readonly invoice: IssuedInvoice }) => <div className="invoice-document card">
  <div className="invoice-parties"><section><p className="eyebrow">Furnizor</p><h2>{invoice.issuer.legalName}</h2><p>{invoice.issuer.taxIdentifier === "" ? null : <>{invoice.issuer.taxIdentifier}<br /></>}{invoice.issuer.address.street}, {invoice.issuer.address.city}</p></section><section><p className="eyebrow">Client</p><h2>{invoice.customer.legalName}</h2><p>{invoice.customer.taxIdentifier === "" ? null : <>{invoice.customer.taxIdentifier}<br /></>}{invoice.customer.address.street}, {invoice.customer.address.city}</p></section></div>
  <div className="table-wrap"><table><caption className="sr-only">Linii factură</caption><thead><tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>TVA</th><th>Total</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unitPrice, invoice.currency)}</td><td>{line.taxRate}%</td><td>{money(line.totalIncludingTax, invoice.currency)}</td></tr>)}</tbody></table></div>
  <div className="invoice-bottom"><dl><div><dt>Subtotal</dt><dd>{money(invoice.totalExcludingTax, invoice.currency)}</dd></div><div><dt>TVA</dt><dd>{money(invoice.taxTotal, invoice.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(invoice.totalIncludingTax, invoice.currency)}</dd></div></dl></div>
</div>
