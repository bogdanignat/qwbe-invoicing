import type { VatChange, VatRegistration } from "./models.ts"

export interface VatSettingsSelection {
  readonly registered: boolean
  readonly effectiveFrom: string
}

export const vatSettingsSelection = (
  saved: VatRegistration | null | undefined,
  defaultEffectiveFrom: string,
): VatSettingsSelection => ({ registered: saved?.registered ?? false, effectiveFrom: saved?.effectiveFrom ?? defaultEffectiveFrom })

export const vatChangeFromSelection = (selection: VatSettingsSelection): VatChange => {
  if (selection.registered) return { registered: true, effectiveFrom: selection.effectiveFrom }
  return { registered: false, effectiveFrom: selection.effectiveFrom, nonVatBasis: "article_310" }
}
