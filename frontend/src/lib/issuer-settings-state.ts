import type { FallbackVatRegistration } from "./issuer-vat-regime.ts"
import type { VatChange } from "./settings-client.ts"
import type { VatRegistration } from "./draft-models.ts"

/**
 * The VAT regime as the settings form holds it, and the sentence under the
 * checkbox.
 *
 * The form carries only what may be changed — whether the issuer charges VAT and
 * from which day — because that is all `vatChange` accepts. The rates themselves
 * are the backend's: choosing "plătitoare" writes the standard configuration,
 * choosing the opposite writes the Article 310 exemption. That is why the
 * non-VAT basis is not a field: there is exactly one supported basis, and
 * sending any other would be refused by the schema
 * (`standalone/api/schema-issuer.ts:27`).
 *
 * The status line is derived rather than stored: a screen that remembers "the
 * user chose this manually" as state can show it after the choice has been
 * saved, which is precisely when it is no longer true.
 */
export interface VatSettingsSelection {
  readonly registered: boolean
  readonly effectiveFrom: string
}

export const vatSettingsSelection = (
  saved: VatRegistration | FallbackVatRegistration | null | undefined,
  defaultEffectiveFrom: string,
): VatSettingsSelection => ({
  registered: saved?.registered ?? false,
  effectiveFrom: saved?.effectiveFrom ?? defaultEffectiveFrom,
})

export const vatChangeFromSelection = (selection: VatSettingsSelection): VatChange =>
  selection.registered
    ? { registered: true, effectiveFrom: selection.effectiveFrom }
    : { registered: false, effectiveFrom: selection.effectiveFrom, nonVatBasis: "article_310" }

/** What the saved profile says, including a regime that is only scheduled or already over. */
export const vatSettingsStatus = (
  registered: boolean,
  fallback: Pick<FallbackVatRegistration, "timing" | "effectiveFrom"> | undefined,
): string => {
  const regime = registered ? "plătitor" : "neplătitor"
  if (fallback?.timing === "scheduled") return `Regimul ${regime} de TVA este programat de la ${fallback.effectiveFrom}.`
  if (fallback?.timing === "expired") {
    return `Ultimul regim ${regime} de TVA a expirat; alege data unei schimbări pentru reactivare.`
  }
  return registered
    ? "Firma este configurată ca plătitoare de TVA."
    : "Firma este configurată ca neplătitoare de TVA."
}

/**
 * A regime the user picked rather than one the profile reports. Exported because
 * a profile whose stored regime cannot be read has nothing else to say: the
 * choice is the only fact on screen (`issuer-vat-baseline.ts`).
 */
export const manualVatStatus = (registered: boolean): string => registered
  ? "Regimul plătitor de TVA a fost ales manual."
  : "Regimul neplătitor de TVA a fost ales manual."

/**
 * The status the screen shows, which is about the *form*, not only about the
 * saved profile: an unsaved choice says so, so nobody reads "este configurată ca
 * plătitoare" next to a checkbox they have just unticked.
 */
export const vatSelectionStatus = (
  selected: VatSettingsSelection,
  saved: VatSettingsSelection,
  fallback: Pick<FallbackVatRegistration, "timing" | "effectiveFrom"> | undefined,
): string => {
  if (selected.registered !== saved.registered) return manualVatStatus(selected.registered)
  return selected.effectiveFrom === saved.effectiveFrom
    ? vatSettingsStatus(selected.registered, fallback)
    : "Data schimbării regimului TVA a fost modificată."
}
