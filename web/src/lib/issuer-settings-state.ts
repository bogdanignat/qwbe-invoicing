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

export const vatSettingsStatus = (
  registered: boolean,
  fallback: { readonly timing: "scheduled" | "expired"; readonly effectiveFrom: string } | undefined,
): string =>
  fallback?.timing === "scheduled"
    ? `Regimul ${registered ? "plătitor" : "neplătitor"} de TVA este programat de la ${fallback.effectiveFrom}.`
    : fallback?.timing === "expired"
      ? `Ultimul regim ${registered ? "plătitor" : "neplătitor"} de TVA a expirat; alege data unei schimbări pentru reactivare.`
      : registered
        ? "Firma este configurată ca plătitoare de TVA."
        : "Firma este configurată ca neplătitoare de TVA."
