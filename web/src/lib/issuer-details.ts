export type LegalForm = "srl" | "pfa"

export interface IssuerLegalDetails {
  readonly legalForm: LegalForm
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
}

interface RawIssuerLegalDetails {
  readonly legalForm: string
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
}

const fail = (message: string): never => { throw new Error(message) }

export const normalizeLegalForm = (value: string): LegalForm => {
  if (value !== "srl" && value !== "pfa") return fail("Selectează forma juridică.")
  return value
}

export const normalizeTradeRegistryNumber = (input: string): string => {
  const value = input.trim().toUpperCase()
  if (value === "") return ""
  if (value.length > 32 || !/^[\x20-\x7E]+$/.test(value)) return fail("Numărul de la Registrul Comerțului trebuie să fie ASCII, pe o singură linie, maximum 32 de caractere.")
  if (!/^(?:[JF]\d{1,2}\/\d+\/\d{4}|[JF]\d{13})$/.test(value)) return fail("Numărul de la Registrul Comerțului nu are formatul acceptat.")
  return value
}

export const normalizeSocialCapital = (input: string): string => {
  const value = input.trim()
  if (value === "") return ""
  const match = /^(\d{1,18})(?:\.(\d{1,2}))?$/.exec(value)
  if (match === null) return fail("Capitalul social trebuie să fie o sumă RON nenegativă, cu maximum 18 cifre întregi și 2 zecimale.")
  const integer = (match[1] ?? "").replace(/^0+(?=\d)/, "")
  const decimals = (match[2] ?? "").padEnd(2, "0")
  return `${integer}.${decimals}`
}

export const normalizeBankName = (input: string): string => {
  const value = input.trim()
  if (Array.from(value).length > 120 || /[\p{C}\p{Zl}\p{Zp}]/u.test(value)) return fail("Numele băncii trebuie să aibă maximum 120 de caractere și o singură linie.")
  return value
}

const ibanMod97 = (value: string): number => {
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`
  let remainder = 0
  for (const character of rearranged) {
    const digits = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder
}

export const normalizeIban = (input: string): string => {
  const value = input.replace(/\s/gu, "").toUpperCase()
  if (value === "") return ""
  if (value.length < 15 || value.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value)) return fail("IBAN-ul nu are structura internațională validă.")
  if (value.startsWith("RO") && value.length !== 24) return fail("Un IBAN românesc trebuie să aibă exact 24 de caractere.")
  if (ibanMod97(value) !== 1) return fail("Cifra de control a IBAN-ului este invalidă.")
  return value
}

export const normalizeIssuerLegalDetails = (input: RawIssuerLegalDetails): IssuerLegalDetails => ({
  legalForm: normalizeLegalForm(input.legalForm),
  tradeRegistryNumber: normalizeTradeRegistryNumber(input.tradeRegistryNumber),
  iban: normalizeIban(input.iban),
  bankName: normalizeBankName(input.bankName),
  socialCapital: normalizeSocialCapital(input.socialCapital),
})

export const issuerIssuanceWarning = (issuer: Pick<IssuerLegalDetails, "legalForm" | "tradeRegistryNumber" | "socialCapital">): string | undefined => {
  if (issuer.tradeRegistryNumber === "") return "Completează numărul de la Registrul Comerțului în setările firmei înainte de emitere."
  if (issuer.legalForm === "srl" && issuer.socialCapital === "") return "Completează capitalul social în setările firmei înainte de emiterea pentru SRL."
  return undefined
}
