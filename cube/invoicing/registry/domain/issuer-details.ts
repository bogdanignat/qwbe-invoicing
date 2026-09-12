import { ValidationFailure } from "../../contracts/failures.ts"
import type { IssuerCompanySnapshot } from "../../domain/invoice.ts"

type CompanyDetails = Pick<IssuerCompanySnapshot, "legalForm" | "tradeRegistryNumber" | "iban" | "bankName" | "socialCapital">
const fail = (issue: string): never => { throw new ValidationFailure({ issues: [issue] }) }

const text = (value: unknown, field: string): string => typeof value === "string" ? value : fail(`${field} must be a string`)

export const normalizeIssuerDetails = (input: CompanyDetails): CompanyDetails => {
  const legalForm: unknown = input.legalForm
  if (legalForm !== "srl" && legalForm !== "pfa") return fail("legalForm must be srl or pfa")
  const tradeRegistryNumber = text(input.tradeRegistryNumber, "tradeRegistryNumber").trim().toUpperCase()
  if (tradeRegistryNumber !== "" && (tradeRegistryNumber.length > 32
    || !/^(?:[JF]\d{1,2}\/\d+\/\d{4}|[JF]\d{13})$/.test(tradeRegistryNumber))) {
    return fail("tradeRegistryNumber must use the legacy or current ONRC format (at most 32 characters)")
  }
  const bankName = text(input.bankName, "bankName").trim()
  if (Array.from(bankName).length > 120 || /[\p{C}\p{Zl}\p{Zp}]/u.test(bankName)) {
    return fail("bankName must be a single line of at most 120 Unicode codepoints")
  }
  const rawCapital = text(input.socialCapital, "socialCapital").trim()
  let socialCapital = ""
  if (rawCapital !== "") {
    const match = /^(\d{1,18})(?:\.(\d{1,2}))?$/.exec(rawCapital)
    if (match === null) return fail("socialCapital must be nonnegative RON with at most 18 integer digits and 2 decimals")
    socialCapital = `${(match[1] as string).replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`
  }
  const iban = text(input.iban, "iban").replace(/\s/gu, "").toUpperCase()
  if (iban !== "") {
    if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)
      || (iban.startsWith("RO") && iban.length !== 24)) return fail("iban has an invalid structure or length")
    let remainder = 0
    for (const character of `${iban.slice(4)}${iban.slice(0, 4)}`) {
      const digits = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character
      for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
    }
    if (remainder !== 1) return fail("iban has an invalid checksum")
  }
  return { legalForm, tradeRegistryNumber, iban, bankName, socialCapital }
}

// Validate the stored snapshot itself; never substitute today's issuer when
// converting a proforma or correcting a previously issued invoice.
export const validateIssuerForIssuance = (issuer: CompanyDetails): void => {
  const normalized = normalizeIssuerDetails(issuer)
  const issues: string[] = []
  for (const field of Object.keys(normalized) as (keyof CompanyDetails)[]) {
    if (issuer[field] !== normalized[field]) issues.push(`${field} must be canonical before issuance`)
  }
  if (normalized.tradeRegistryNumber === "") issues.push("tradeRegistryNumber is required before issuance")
  if (normalized.legalForm === "srl" && normalized.socialCapital === "") issues.push("socialCapital is required for SRL before issuance")
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
