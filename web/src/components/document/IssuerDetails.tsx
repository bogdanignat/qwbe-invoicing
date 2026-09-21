import type { Issuer } from "../../lib/models.ts"
import { formattedRomanianAddress, issuerPresentationIdentity, type IssuerVatPresentation } from "../../lib/fiscal-identity.ts"
import { IssuerBrand } from "./IssuerBrand.tsx"

type IssuerPresentation = Pick<Issuer, "address" | "bankName" | "branding" | "fiscalIdentifier" | "iban" | "legalForm" | "name" | "socialCapital" | "tradeRegistryNumber">
  & IssuerVatPresentation

interface IssuerDetailsProps {
  readonly issuer: IssuerPresentation
}

export const IssuerDetails = ({ issuer }: IssuerDetailsProps) => {
  const identity = issuerPresentationIdentity(issuer)
  return <>
  <IssuerBrand branding={issuer.branding} />
  <h2>{issuer.name}</h2>
  <p className="document-party-details">
    Formă juridică: {issuer.legalForm.toUpperCase()}<br />
    {identity.fiscalIdentifier === "" ? null : <>CUI / CIF: {identity.fiscalIdentifier}<br /></>}
    {identity.vatIdentifier === null ? null : <>Cod TVA: {identity.vatIdentifier}<br /></>}
    {issuer.tradeRegistryNumber === "" ? null : <>Nr. Reg. Com.: {issuer.tradeRegistryNumber}<br /></>}
    {issuer.socialCapital === "" ? null : <>Capital social: {issuer.socialCapital} RON<br /></>}
    {issuer.iban === "" ? null : <>IBAN: {issuer.iban}<br /></>}
    {issuer.bankName === "" ? null : <>Bancă: {issuer.bankName}<br /></>}
    <span className="document-address">{formattedRomanianAddress(issuer.address)}</span>
  </p>
</>
}
