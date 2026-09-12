import type { Issuer } from "../models.ts"
import { IssuerBrand } from "./IssuerBrand.tsx"

export const SellerSummary = ({ issuer }: { readonly issuer: Issuer }) => <section className="card authoring-section seller-summary">
  <div className="section-heading"><div><h2>1. Furnizor</h2><p>Date preluate din configurarea firmei.</p></div><a href="/settings">Modifică în setări</a></div>
  <IssuerBrand branding={issuer.branding} />
  <dl className="summary-list"><div><dt>Denumire</dt><dd>{issuer.name}</dd></div><div><dt>CUI / CIF</dt><dd>{issuer.fiscalIdentifier}</dd></div><div><dt>Formă juridică</dt><dd>{issuer.legalForm.toUpperCase()}</dd></div><div><dt>Nr. Registrul Comerțului</dt><dd style={{ overflowWrap: "anywhere" }}>{issuer.tradeRegistryNumber || "—"}</dd></div><div><dt>Adresă</dt><dd>{issuer.address.street}, {issuer.address.city}{issuer.address.county === undefined ? "" : `, ${issuer.address.county}`}</dd></div>{issuer.socialCapital === "" ? null : <div><dt>Capital social</dt><dd>{issuer.socialCapital} RON</dd></div>}{issuer.iban === "" ? null : <div><dt>IBAN</dt><dd style={{ overflowWrap: "anywhere" }}>{issuer.iban}</dd></div>}{issuer.bankName === "" ? null : <div><dt>Bancă</dt><dd style={{ overflowWrap: "anywhere" }}>{issuer.bankName}</dd></div>}</dl>
</section>
