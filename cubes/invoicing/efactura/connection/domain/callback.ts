import type { AttemptVerdict } from "./connection.ts"

/**
 * Where ANAF's callback sends the browser, and why. Always the same page with
 * one fixed code: nothing of ANAF's answer, the code or the cookie travels on.
 */
export const CALLBACK_OUTCOMES = [
  "conectat", "neconfigurat", "tentativa_lipsa", "tentativa_expirata", "tentativa_folosita", "refuzat_anaf",
  "cod_lipsa", "schimb_esuat", "fara_drept_cif", "verificare_esuata", "conexiune_schimbata", "eroare",
] as const
export type CallbackOutcome = (typeof CALLBACK_OUTCOMES)[number]

export const CALLBACK_TARGET_PATH = "/integrations"

export const callbackTarget = (outcome: CallbackOutcome): string => `${CALLBACK_TARGET_PATH}?anaf=${outcome}`

/** A callback whose attempt is not usable ends here. A replaced attempt no longer exists, so it reads as missing. */
export const attemptOutcome: Readonly<Record<Exclude<AttemptVerdict, "usable">, CallbackOutcome>> = {
  missing: "tentativa_lipsa", expired: "tentativa_expirata", consumed: "tentativa_folosita",
}

/** What the read-only list call proved about the token's right on the issuer's CIF. */
export type CifVerdict = "granted" | "no_right" | "failed"

export const cifOutcome: Readonly<Record<Exclude<CifVerdict, "granted">, CallbackOutcome>> = {
  no_right: "fara_drept_cif", failed: "verificare_esuata",
}

/** The CIF as the SPV knows it: the issuer's fiscal identifier without `RO`; `undefined` when it is not one. */
export const spvCif = (fiscalIdentifier: string): string | undefined => {
  const cif = fiscalIdentifier.trim().toUpperCase().replace(/^RO\s*/u, "")
  return /^[0-9]{2,10}$/u.test(cif) ? cif : undefined
}

/** An authorization code as ANAF hands it over: one bounded run of printable characters, or nothing usable. */
export const usableCode = (code: string | undefined): code is string =>
  code !== undefined && /^[\x21-\x7e]{1,4096}$/u.test(code)

/** ANAF does not say when a refresh token lapses; it lives 365 days from the grant. */
export const REFRESH_TOKEN_DAYS = 365
