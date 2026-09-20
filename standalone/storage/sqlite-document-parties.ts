import type { IssuedInvoice, Proforma } from "../../cube/invoicing/index.ts"
import { normalizeIssuerDetails, validateIssuerForIssuance } from "../../cube/invoicing/issuer/index.ts"
import { booleanInteger, nullableText, partyFrom, type Row } from "./sqlite-rows.ts"

export const issuerCompanyDetailsFrom = (value: Row, prefix: string, issued = true) => {
  const legalFormValue = value[`${prefix}legal_form`]
  if (legalFormValue !== "srl" && legalFormValue !== "pfa") throw new Error("invalid stored issuer legalForm")
  const field = (name: string) => {
    const result = value[`${prefix}${name}`]
    if (typeof result !== "string") throw new Error(`invalid ${prefix}${name}`)
    return result
  }
  const stored: Parameters<typeof normalizeIssuerDetails>[0] = {
    legalForm: legalFormValue, tradeRegistryNumber: field("trade_registry_number"), iban: field("iban"),
    bankName: field("bank_name"), socialCapital: field("social_capital"),
  }
  const normalized = normalizeIssuerDetails(stored)
  for (const name of Object.keys(normalized) as (keyof typeof normalized)[]) {
    if (stored[name] !== normalized[name]) throw new Error(`invalid stored issuer ${name}`)
  }
  if (issued) validateIssuerForIssuance(normalized)
  return { ...partyFrom(value, prefix), ...normalized }
}

export const issuerCompanyFrom = (value: Row, prefix: string) => ({
  ...issuerCompanyDetailsFrom(value, prefix), vatRegistered: booleanInteger(value, `${prefix}vat_registered`),
})

export const brandingFrom = (value: Row, field: string) => {
  if (!(field in value)) throw new Error(`missing ${field}`)
  const serialized = nullableText(value, field)
  if (serialized === null) return null
  const branding: unknown = JSON.parse(serialized)
  if (typeof branding !== "object" || branding === null || Array.isArray(branding)) throw new Error(`invalid ${field}`)
  const candidate = branding as Readonly<Record<string, unknown>>
  const image = candidate.image
  if (!(candidate.text === null || typeof candidate.text === "string")
    || !(image === null || (typeof image === "object" && !Array.isArray(image)
      && typeof (image as Readonly<Record<string, unknown>>).pngBase64 === "string"
      && typeof (image as Readonly<Record<string, unknown>>).width === "number"
      && typeof (image as Readonly<Record<string, unknown>>).height === "number"))) throw new Error(`invalid ${field}`)
  return branding as NonNullable<IssuedInvoice["issuer"]["branding"]>
}

export const issuerFrom = (value: Row, brandingField: string) => ({
  ...issuerCompanyFrom(value, "issuer_"), branding: brandingFrom(value, brandingField),
})

export const withoutIssuerBranding = (document: IssuedInvoice | Proforma) => {
  const issuer = {
    name: document.issuer.name, fiscalIdentifier: document.issuer.fiscalIdentifier,
    address: structuredClone(document.issuer.address), legalForm: document.issuer.legalForm,
    tradeRegistryNumber: document.issuer.tradeRegistryNumber, iban: document.issuer.iban,
    bankName: document.issuer.bankName, socialCapital: document.issuer.socialCapital,
    vatRegistered: document.issuer.vatRegistered,
  }
  return { ...document, issuer }
}
