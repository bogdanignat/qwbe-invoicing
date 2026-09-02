import { money } from "../format.ts"
import type { DraftInvoice } from "../models.ts"

export const InvoiceTotals = ({ draft }: { readonly draft: DraftInvoice | undefined }) => <aside className="card sticky-card summary-card authoring-summary">
  <h2>Totaluri calculate de server</h2>
  {draft === undefined ? <p>Salvează draftul și liniile pentru calculul fiscal.</p> : <><dl><div><dt>Subtotal</dt><dd>{money(draft.totalExcludingTax, draft.currency)}</dd></div><div><dt>TVA</dt><dd>{money(draft.taxTotal, draft.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(draft.totalIncludingTax, draft.currency)}</dd></div></dl>{draft.taxBreakdown.length === 0 ? null : <div className="tax-breakdown"><h3>Detaliu TVA</h3>{draft.taxBreakdown.map((tax) => <p key={`${tax.taxCode}-${tax.rate}`}>{tax.rate}%: bază {money(tax.taxableAmount, draft.currency)}, TVA {money(tax.taxAmount, draft.currency)}</p>)}</div>}</>}
</aside>
