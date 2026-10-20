import { formatDecimal, parseDecimal } from "../../cubes/invoicing/contracts/money.ts"
import { romanianCountyName } from "../../cubes/invoicing/index.ts"
import type {
  RenderableCorrection, RenderableInvoice, RenderableParty, RenderableProforma,
} from "../../cubes/invoicing/documents/index.ts"

export type RenderableDocument = RenderableInvoice | RenderableProforma | RenderableCorrection
export type RenderableLine = RenderableInvoice["lines"][number]

/**
 * An amount for people: thousands grouped with a comma, a point before the
 * fraction and the scale it came with, so money keeps `.DD` and a quantity
 * `.DDDD` (`6,600.00`, `-1,250,000.00`, `4,800.0000`). Zero is never signed.
 * Text that is no decimal is printed as it came. The browser writes the same
 * (frontend/src/lib/money.ts, held equal by probes/frontend-cube-parity.test.mjs).
 */
export const formatAmount = (value: string): string => {
  const scale = value.split(".")[1]?.length ?? 0
  const parsed = parseDecimal(value, scale)
  if (!parsed.ok) return value
  const [whole = "", fraction] = formatDecimal(parsed.units, scale).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+$)/gu, ",")
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** A VAT rate without its idle zeros: `21.00` is `21`, `20.50` is `20.5`. */
export const formatRate = (rate: string): string =>
  formatAmount(rate.includes(".") ? rate.replace(/\.?0+$/u, "") : rate)

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
