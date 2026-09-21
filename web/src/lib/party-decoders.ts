import {
  issuerIssuanceWarning, normalizeIssuerLegalDetails, type IssuerLegalDetails,
} from "./issuer-details.ts"
import { isRomanianCountyCode } from "./romanian-counties.ts"
import {
  boolean, integer, nullableText, object, optionalInteger, optionalText, text, type Decoder,
} from "./model-decoder.ts"
import type {
  Address, BuyerSnapshot, Customer, IssuerBranding, IssuerBrandingImage,
  IssuerCompanySnapshot, IssuerSnapshot, Party, PartyType,
} from "./party-models.ts"

export const decodeAddress: Decoder<Address> = (input) => {
  const value = object(input)
  const county = text(value.county, "county")
  const sector = optionalInteger(value.sector, "sector")
  const postalCode = optionalText(value.postalCode, "postalCode")
  if (!isRomanianCountyCode(county)) throw new Error("invalid county")
  if (county === "RO-B" ? sector === undefined || sector < 1 || sector > 6 : sector !== undefined) {
    throw new Error("invalid sector")
  }
  return {
    countryCode: text(value.countryCode, "countryCode"),
    city: text(value.city, "city"),
    street: text(value.street, "street"),
    county,
    ...(sector === undefined ? {} : { sector }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}

export const decodeParty: Decoder<Party> = (input) => {
  const value = object(input)
  return {
    name: text(value.name, "name"),
    fiscalIdentifier: text(value.fiscalIdentifier, "fiscalIdentifier"),
    address: decodeAddress(value.address),
  }
}

const canonicalCui = (value: string): string => {
  if (!/^[0-9]+$/.test(value)) throw new Error("invalid fiscalIdentifier")
  return value
}

const decodeIssuerCompany = (input: unknown): Party & IssuerLegalDetails => {
  const value = object(input)
  const raw = {
    legalForm: text(value.legalForm, "legalForm"),
    tradeRegistryNumber: text(value.tradeRegistryNumber, "tradeRegistryNumber"),
    iban: text(value.iban, "iban"),
    bankName: text(value.bankName, "bankName"),
    socialCapital: text(value.socialCapital, "socialCapital"),
  }
  let details: IssuerLegalDetails
  try {
    details = normalizeIssuerLegalDetails(raw)
  } catch (cause) {
    throw new Error(
      cause instanceof Error ? `invalid issuer details: ${cause.message}` : "invalid issuer details",
      { cause },
    )
  }
  for (const field of ["tradeRegistryNumber", "iban", "bankName", "socialCapital"] as const) {
    if (details[field] !== raw[field]) throw new Error(`invalid ${field}`)
  }
  const party = decodeParty(value)
  return { ...party, fiscalIdentifier: canonicalCui(party.fiscalIdentifier), ...details }
}

export const decodeIssuerCompanySnapshot: Decoder<IssuerCompanySnapshot> = (input) => {
  const value = object(input)
  return { ...decodeIssuerCompany(value), vatRegistered: boolean(value.vatRegistered, "vatRegistered") }
}

export const decodeIssuedIssuerCompanySnapshot: Decoder<IssuerCompanySnapshot> = (input) => {
  const issuer = decodeIssuerCompanySnapshot(input)
  const issue = issuerIssuanceWarning(issuer)
  if (issue !== undefined) throw new Error(`invalid issued issuer: ${issue}`)
  return issuer
}

const decodeIssuerBrandingImage: Decoder<IssuerBrandingImage> = (input) => {
  const value = object(input)
  const pngBase64 = text(value.pngBase64, "pngBase64")
  const width = integer(value.width, "width")
  const height = integer(value.height, "height")
  if (pngBase64.length === 0 || width <= 0 || height <= 0) throw new Error("invalid issuer branding image")
  return { pngBase64, width, height }
}

const decodeIssuerBranding: Decoder<IssuerBranding> = (input) => {
  const value = object(input)
  return {
    text: nullableText(value.text, "branding.text"),
    image: value.image === null ? null : decodeIssuerBrandingImage(value.image),
  }
}

export const decodeIssuerSnapshot: Decoder<IssuerSnapshot> = (input) => {
  const value = object(input)
  return {
    ...decodeIssuedIssuerCompanySnapshot(value),
    branding: value.branding === null ? null : decodeIssuerBranding(value.branding),
  }
}

export const decodeIssuerProfileSnapshot: Decoder<Omit<IssuerSnapshot, "vatRegistered">> = (input) => {
  const value = object(input)
  return {
    ...decodeIssuerCompany(value),
    branding: value.branding === null ? null : decodeIssuerBranding(value.branding),
  }
}

const decodePartyType = (input: unknown): PartyType => {
  const value = text(input, "partyType")
  if (value !== "company" && value !== "individual") throw new Error("invalid partyType")
  return value
}

export const decodeBuyer: Decoder<BuyerSnapshot> = (input) => {
  const value = object(input)
  const partyType = decodePartyType(value.partyType)
  const vatRegistered = boolean(value.vatRegistered, "vatRegistered")
  if (partyType === "individual" && vatRegistered) throw new Error("invalid vatRegistered")
  const party = decodeParty(value)
  const fiscalIdentifier = partyType === "company"
    ? canonicalCui(party.fiscalIdentifier)
    : party.fiscalIdentifier
  if (partyType === "individual" && fiscalIdentifier !== "" && !/^[0-9]{13}$/.test(fiscalIdentifier)) {
    throw new Error("invalid fiscalIdentifier")
  }
  return { ...party, fiscalIdentifier, partyType, vatRegistered }
}

export const decodeCustomer: Decoder<Customer> = (input) => {
  const value = object(input)
  const defaultPaymentTermDays = optionalInteger(value.defaultPaymentTermDays, "defaultPaymentTermDays")
  if (defaultPaymentTermDays !== undefined && defaultPaymentTermDays < 0) {
    throw new Error("invalid defaultPaymentTermDays")
  }
  return {
    ...decodeBuyer(value),
    id: text(value.id, "id"),
    organizationId: text(value.organizationId, "organizationId"),
    ...(defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays }),
  }
}
