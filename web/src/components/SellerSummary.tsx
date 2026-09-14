import type { Issuer } from "../models.ts"
import { IssuerDetails } from "./IssuerDetails.tsx"

export const SellerSummary = ({ issuer }: { readonly issuer: Issuer }) => <section className="seller-summary document-party">
  <div className="section-heading"><div><p className="eyebrow">Furnizor</p><p>Date preluate din configurarea firmei.</p></div><a href="/settings">Modifică în setări</a></div>
  <IssuerDetails issuer={issuer} />
</section>
