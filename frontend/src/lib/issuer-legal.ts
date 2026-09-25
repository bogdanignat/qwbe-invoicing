/**
 * The four legal fields of the issuer profile, each as a value or the sentence
 * that refuses it.
 *
 * The legacy screen threw from its normalizers and caught the exception in the
 * submit handler, which made "which field is wrong" a message string the form
 * could not point at. Here every rule answers, so `issuer-payload.ts` can name
 * the field the keyboard is moved to and each rule is tested without a DOM.
 *
 * The rules themselves are the backend's (`cube/invoicing/issuer`): the trade
 * registry number in either the classic or the 13-digit form, an IBAN with a
 * valid mod-97 check digit, a social capital with at most 18 integer digits and
 * two decimals, a bank name of at most 120 characters on one line. Three of the
 * four may be empty — the profile is saveable before it is complete, and the
 * missing pieces are refused at issuance, not here.
 */
export type LegalValue =
  | { readonly kind: "ready"; readonly value: string }
  | { readonly kind: "issue"; readonly message: string }

const ready = (value: string): LegalValue => ({ kind: "ready", value })
const issue = (message: string): LegalValue => ({ kind: "issue", message })

export const TRADE_REGISTRY_MAX_LENGTH = 32
export const BANK_NAME_MAX_CODE_POINTS = 120

export const tradeRegistryValue = (input: string): LegalValue => {
  const value = input.trim().toUpperCase()
  if (value === "") return ready("")
  if (value.length > TRADE_REGISTRY_MAX_LENGTH || !/^[\x20-\x7E]+$/u.test(value)) {
    return issue("Numărul de la Registrul Comerțului trebuie să fie ASCII, pe o singură linie, maximum 32 de caractere.")
  }
  return /^(?:[JF]\d{1,2}\/\d+\/\d{4}|[JF]\d{13})$/u.test(value)
    ? ready(value)
    : issue("Numărul de la Registrul Comerțului nu are formatul acceptat.")
}

/** Stored with exactly two decimals, so `200` and `200.00` are the same capital. */
export const socialCapitalValue = (input: string): LegalValue => {
  const value = input.trim()
  if (value === "") return ready("")
  const match = /^(\d{1,18})(?:\.(\d{1,2}))?$/u.exec(value)
  if (match === null) {
    return issue("Capitalul social trebuie să fie o sumă RON nenegativă, cu maximum 18 cifre întregi și 2 zecimale.")
  }
  const whole = (match[1] ?? "").replace(/^0+(?=\d)/u, "")
  return ready(`${whole}.${(match[2] ?? "").padEnd(2, "0")}`)
}

export const bankNameValue = (input: string): LegalValue => {
  const value = input.trim()
  return Array.from(value).length > BANK_NAME_MAX_CODE_POINTS || /[\p{C}\p{Zl}\p{Zp}]/u.test(value)
    ? issue("Numele băncii trebuie să aibă maximum 120 de caractere și o singură linie.")
    : ready(value)
}

/** ISO 7064 mod 97-10: the four leading characters move to the end, letters become two digits. */
const ibanMod97 = (value: string): number => {
  let remainder = 0
  for (const character of `${value.slice(4)}${value.slice(0, 4)}`) {
    const digits = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder
}

export const ibanValue = (input: string): LegalValue => {
  const value = input.replace(/\s/gu, "").toUpperCase()
  if (value === "") return ready("")
  if (value.length < 15 || value.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/u.test(value)) {
    return issue("IBAN-ul nu are structura internațională validă.")
  }
  if (value.startsWith("RO") && value.length !== 24) return issue("Un IBAN românesc trebuie să aibă exact 24 de caractere.")
  return ibanMod97(value) === 1 ? ready(value) : issue("Cifra de control a IBAN-ului este invalidă.")
}
