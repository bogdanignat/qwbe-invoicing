import type { Issuer } from "../models.ts"
import { IssuerBrand } from "./IssuerBrand.tsx"

type IssuerPresentation = Pick<Issuer, "address" | "bankName" | "branding" | "fiscalIdentifier" | "iban" | "legalForm" | "name" | "socialCapital" | "tradeRegistryNumber">

interface IssuerDetailsProps {
  readonly issuer: IssuerPresentation
}

const formattedAddress = (address: IssuerPresentation["address"]): string =>
  [address.street, address.city, address.county, address.postalCode, address.countryCode]
    .filter((part) => part !== undefined && part !== "")
    .join(", ")

export const IssuerDetails = ({ issuer }: IssuerDetailsProps) => <>
  <IssuerBrand branding={issuer.branding} />
  <h2>{issuer.name}</h2>
  <p className="document-party-details">
    Formă juridică: {issuer.legalForm.toUpperCase()}<br />
    {issuer.fiscalIdentifier === "" ? null : <>CUI / CIF: {issuer.fiscalIdentifier}<br /></>}
    {issuer.tradeRegistryNumber === "" ? null : <>Nr. Reg. Com.: {issuer.tradeRegistryNumber}<br /></>}
    {issuer.socialCapital === "" ? null : <>Capital social: {issuer.socialCapital} RON<br /></>}
    {issuer.iban === "" ? null : <>IBAN: {issuer.iban}<br /></>}
    {issuer.bankName === "" ? null : <>Bancă: {issuer.bankName}<br /></>}
    <span className="document-address">{formattedAddress(issuer.address)}</span>
  </p>
</>
