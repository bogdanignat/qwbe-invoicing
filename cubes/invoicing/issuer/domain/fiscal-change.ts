import { ValidationFailure } from "../../contracts/failures.ts"
import type { VatConfiguration } from "../../domain/invoice.ts"
import type { VatRegistryStatus } from "../contracts/fiscal-guard.ts"
import type { IssuerProfile, VatChange } from "./issuer.ts"
import { changesVatRegistration, currentVatRegistration } from "./vat-regime.ts"

/**
 * What a save changes for tax purposes. A new regime rewrites every day from
 * `regimeFrom` on; a new CIF of a configured issuer touches every document it
 * ever issued. Address, IBAN or branding change nothing here.
 */
export interface FiscalChange {
  readonly regimeFrom: string | undefined
  readonly cifChanged: boolean
}

export const fiscalChangeOf = (existing: IssuerProfile | undefined, cif: string, change: VatChange): FiscalChange => ({
  regimeFrom: changesVatRegistration(existing?.vatConfigurations ?? [], change) ? change.effectiveFrom : undefined,
  cifChanged: existing !== undefined && existing.fiscalIdentifier !== cif,
})

/** One question for the registry: on `date`, must the CIF be registered for VAT or not. */
export interface RegistryCheck {
  readonly date: string
  readonly registered: boolean
}

/**
 * A new regime is checked on the day it starts and today, both against the regime
 * chosen; a new CIF alone, against the regime in force today (or, when none is
 * yet, the first one scheduled). No fiscal change asks nothing.
 */
export const registryChecks = (
  fiscal: FiscalChange, configurations: ReadonlyArray<VatConfiguration>, change: VatChange, today: string,
): ReadonlyArray<RegistryCheck> => {
  if (fiscal.regimeFrom !== undefined) {
    return [...new Set([fiscal.regimeFrom, today])].map((date) => ({ date, registered: change.registered }))
  }
  if (!fiscal.cifChanged) return []
  const first = configurations.map(({ effectiveFrom }) => effectiveFrom).sort()[0] ?? today
  const date = currentVatRegistration(configurations, today) === undefined ? first : today
  const registration = currentVatRegistration(configurations, date)
  if (registration === undefined) throw new ValidationFailure({ issues: [`issuer VAT registration must be configured on ${date}`] })
  return [{ date, registered: registration.registered }]
}

/** Why the registry's answer refuses the save, in the words the settings screen shows; `undefined` when it agrees. */
export const registryIssue = (cif: string, check: RegistryCheck, status: VatRegistryStatus): string | undefined => {
  if (status === "unknown_cif") return `CIF-ul ${cif} nu figurează în registrul ANAF al plătitorilor de TVA.`
  if (check.registered && status === "not_registered") {
    return `ANAF arată că CIF-ul ${cif} nu este înregistrat în scopuri de TVA la ${check.date}; firma nu poate fi salvată ca plătitoare de TVA.`
  }
  if (!check.registered && status === "registered") {
    return `ANAF arată că CIF-ul ${cif} este înregistrat în scopuri de TVA la ${check.date}; firma nu poate fi salvată ca neplătitoare (art. 310).`
  }
  return undefined
}

const fiscalState = (issuer: IssuerProfile | undefined) => issuer === undefined ? null : {
  cif: issuer.fiscalIdentifier,
  vat: issuer.vatConfigurations.map(({ code, rate, vatCategoryCode, vatExemptionReason, effectiveFrom, effectiveTo }) =>
    [code, rate, vatCategoryCode, vatExemptionReason, effectiveFrom, effectiveTo ?? null]),
}

/** Whether the CIF and the VAT history read again are, field by field, the ones the save was decided on. */
export const sameFiscalState = (before: IssuerProfile | undefined, current: IssuerProfile | undefined): boolean =>
  JSON.stringify(fiscalState(before)) === JSON.stringify(fiscalState(current))
