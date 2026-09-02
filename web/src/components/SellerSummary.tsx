import type { Issuer } from "../models.ts"

export const SellerSummary = ({ issuer }: { readonly issuer: Issuer }) => <section className="card authoring-section seller-summary">
  <div className="section-heading"><div><h2>1. Furnizor</h2><p>Date preluate din configurarea firmei.</p></div><a href="#/settings">Modifică în setări</a></div>
  <dl className="summary-list"><div><dt>Denumire</dt><dd>{issuer.legalName}</dd></div><div><dt>CUI / CIF</dt><dd>{issuer.taxIdentifier}</dd></div><div><dt>Adresă</dt><dd>{issuer.address.street}, {issuer.address.city}{issuer.address.county === undefined ? "" : `, ${issuer.address.county}`}</dd></div></dl>
</section>
