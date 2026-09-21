import { romanianCountyName } from "../../cube/invoicing/index.ts"
import type { RenderableInvoice, RenderableParty, RenderableProforma } from "../../cube/invoicing/documents/index.ts"

export type RenderableDocument = RenderableInvoice | RenderableProforma
export type RenderableLine = RenderableInvoice["lines"][number]

export const formatAmount = (value: string): string => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) return value
  const sign = match[1] ?? ""
  const whole = (match[2] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const fraction = match[3]
  return fraction === undefined ? `${sign}${whole}` : `${sign}${whole},${fraction}`
}

export const formatRate = (rate: string): string => {
  if (!rate.includes(".")) return rate
  const stripped = rate.replace(/0+$/, "").replace(/\.$/, "")
  return formatAmount(stripped === "" ? "0" : stripped)
}

export const partyIdentifierLine = (party: RenderableParty): string | undefined => party.fiscalIdentifier === ""
  ? undefined
  : `${party.partyType === "individual" ? "CNP" : "CUI"}: ${party.fiscalIdentifier}${party.vatRegistered ? ` · Cod TVA: RO${party.fiscalIdentifier}` : ""}`

export const documentDateLine = (document: Pick<RenderableDocument, "issueDate" | "dueDate">): string =>
  `Data emiterii: ${document.issueDate}${document.dueDate === null ? "" : `   Scadență: ${document.dueDate}`}`

export const partyAddressLines = (party: RenderableParty): ReadonlyArray<string> => {
  const region = [
    romanianCountyName(party.address.county),
    party.address.sector === undefined ? undefined : `Sector ${String(party.address.sector)}`,
    party.address.postalCode,
  ].filter((part) => part !== undefined && part !== "")
  return [
    party.address.street,
    [party.address.city, ...region].filter((part) => part !== "").join(", "),
    party.address.countryCode,
  ].filter((line) => line !== "")
}

export const issuerLegalLines = (issuer: RenderableDocument["issuer"]): ReadonlyArray<string> => [
  `Formă juridică: ${issuer.legalForm.toUpperCase()}`,
  issuer.vatRegistered ? "Plătitor de TVA" : "Neplătitor de TVA",
  issuer.tradeRegistryNumber === "" ? "" : `Nr. registrul comerțului: ${issuer.tradeRegistryNumber}`,
  issuer.socialCapital === "" ? "" : `Capital social: ${formatAmount(issuer.socialCapital)} RON`,
  issuer.bankName === "" ? "" : `Bancă: ${issuer.bankName}`,
  issuer.iban === "" ? "" : `IBAN: ${issuer.iban}`,
].filter((line) => line !== "")
