import { activeOn, configurationRegistration } from "./vat-defaults.ts"
import { fallbackVatRegistration, type FallbackVatRegistration } from "./issuer-vat-regime.ts"
import {
  manualVatStatus, vatSelectionStatus, vatSettingsSelection, type VatSettingsSelection,
} from "./issuer-settings-state.ts"
import type { Issuer, VatConfiguration } from "./draft-models.ts"

/**
 * The regime the settings form opens on, read against one single day.
 *
 * The issuer answer carries `currentVat`, but that is a snapshot the server
 * computed when it built the answer (`cube/invoicing/issuer/application/issuer-view.ts`),
 * and the query client keeps it without refetching on focus. The form's own
 * `today` moves on; the snapshot does not. A tab left open across midnight then
 * holds two different days at once, and the disagreement is not cosmetic: the
 * regime the form shows becomes the `vatChange` the next save writes, so a
 * scheduled VAT registration that came into force overnight would be reported
 * as "neplătitoare" and overwritten with an Article 310 exemption by a save the
 * user made about something else entirely.
 *
 * So the snapshot is not read here at all. The regime is projected from the
 * stored configurations against the same `today` as everything else on the
 * screen — the same projection the backend performs — and the scheduled or
 * expired neighbour is the same fallback as before. Both halves now answer the
 * same question about the same day, by construction rather than by luck.
 *
 * What cannot be projected is not guessed. `kind: "unknown"` is a saved profile
 * whose configurations name no regime today and no neighbouring one either: the
 * screen says so and the save is refused until the checkbox is answered, because
 * the alternative is writing an exemption nobody asked for. `kind: "unsaved"` is
 * the profile that does not exist yet (`GET /api/issuer` answers `404`), where an
 * unticked checkbox is a default offered to a new profile, not a regime imposed
 * over stored ones.
 */
export interface IssuerVatBaseline {
  /** `unsaved`: no profile yet. `known`: a regime today, or a scheduled/expired one. `unknown`: neither. */
  readonly kind: "unsaved" | "known" | "unknown"
  readonly selection: VatSettingsSelection
  /** Set only when the regime the form opens on is not the one in force today. */
  readonly fallback: FallbackVatRegistration | undefined
}

export const UNKNOWN_VAT_STATUS = "Regimul TVA în vigoare azi nu poate fi determinat din configurațiile salvate. "
  + "Alege explicit regimul: nimic nu este presupus."

export const UNKNOWN_VAT_CHOICE_REQUIRED = "Regimul TVA în vigoare nu poate fi determinat. "
  + "Bifează sau debifează explicit „Plătitoare de TVA” înainte de salvare."

/**
 * The regime in force on `date`, from the configurations themselves.
 *
 * The period is dated by the earliest configuration still active, which is what
 * the backend reports as `currentVat.effectiveFrom`: the rates of one regime may
 * start on different days when the catalogue changes mid-regime, and the regime
 * began on the first of them.
 */
export const currentVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>,
  date: string,
): VatSettingsSelection | undefined => {
  const active = configurations.filter((configuration) => activeOn(configuration, date))
  const registered = configurationRegistration(active)
  const effectiveFrom = [...active].map(({ effectiveFrom: from }) => from).sort()[0]
  return registered === undefined || effectiveFrom === undefined
    ? undefined
    : { registered, effectiveFrom }
}

export const issuerVatBaseline = (issuer: Issuer | null, today: string): IssuerVatBaseline => {
  if (issuer === null) {
    return { kind: "unsaved", selection: vatSettingsSelection(null, today), fallback: undefined }
  }
  const current = currentVatRegistration(issuer.vatConfigurations, today)
  if (current !== undefined) return { kind: "known", selection: current, fallback: undefined }
  const fallback = fallbackVatRegistration(issuer.vatConfigurations, today)
  return fallback === undefined
    ? { kind: "unknown", selection: vatSettingsSelection(null, today), fallback: undefined }
    : { kind: "known", selection: vatSettingsSelection(fallback, today), fallback }
}

/**
 * Why the save is refused, when it is. `chosen` is whether the user answered the
 * checkbox during this edit — an unreadable regime is never saved over by a form
 * that merely opened on a default.
 */
export const issuerVatSubmitIssue = (
  baseline: IssuerVatBaseline, chosen: boolean,
): string | undefined => baseline.kind === "unknown" && !chosen ? UNKNOWN_VAT_CHOICE_REQUIRED : undefined

export const issuerVatStatus = (
  baseline: IssuerVatBaseline, selected: VatSettingsSelection, chosen: boolean,
): string => {
  if (baseline.kind !== "unknown") return vatSelectionStatus(selected, baseline.selection, baseline.fallback)
  return chosen ? manualVatStatus(selected.registered) : UNKNOWN_VAT_STATUS
}
