import { money } from "../format.ts"
import type { DraftInvoice } from "../models.ts"

export const InvoiceTotals = ({ draft }: { readonly draft: DraftInvoice | undefined }) => <aside className="card sticky-card summary-card authoring-summary">
  <h2>Totaluri calculate de server</h2>
  {draft === undefined ? <p>Salvează draftul și liniile pentru calculul fiscal.</p> : <><dl><div><dt>Subtotal</dt><dd>{money(draft.totalExcludingVat, draft.currency)}</dd></div><div><dt>TVA</dt><dd>{money(draft.vatTotal, draft.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(draft.totalIncludingVat, draft.currency)}</dd></div></dl>{draft.vatBreakdown.length === 0 ? null : <div className="tax-breakdown"><h3>Detaliu TVA</h3>{draft.vatBreakdown.map((tax) => <p key={`${tax.code}-${tax.rate}`}>{tax.rate}%: bază {money(tax.vatBaseAmount, draft.currency)}, TVA {money(tax.vatAmount, draft.currency)}</p>)}</div>}</>}
</aside>
