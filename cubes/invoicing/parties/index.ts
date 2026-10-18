const identity = "parties"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    summary: "Romanian fiscal party rules shared by the issuer, saved customers and inline buyers: CUI, CNP, counties and sectors",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { isValidRomanianCnp, isValidRomanianCui, validateBuyer, validateParty } from "./domain/party-validation.ts"
export { ROMANIAN_COUNTIES, isRomanianCountyCode, romanianCountyName } from "./domain/romanian-counties.ts"
export type { RomanianCounty } from "./domain/romanian-counties.ts"
