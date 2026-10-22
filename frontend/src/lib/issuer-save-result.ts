import { decodeIssuer } from "./authoring-reference-decoders.ts"
import type { Issuer } from "./draft-models.ts"
import { array, literal, object, type Decoder } from "./model-decoder.ts"

/**
 * The answer to the issuer `PUT`, and what each of its outcomes says on screen.
 *
 * It is the saved profile plus `warnings`, which only this write carries
 * (`kernel/api/schema-issuer.ts`): the read decoder would drop them, so the
 * save has its own. `vat_registry_not_checked` means the regime or the CIF
 * changed while the company-lookup plugin, and with it the ANAF check, is off.
 */
export const ISSUER_WARNINGS = ["vat_registry_not_checked"] as const
export type IssuerWarning = typeof ISSUER_WARNINGS[number]

export interface IssuerSaveResult {
  readonly issuer: Issuer
  readonly warnings: ReadonlyArray<IssuerWarning>
}

export const decodeIssuerSaveResult: Decoder<IssuerSaveResult> = (input) => ({
  issuer: decodeIssuer(input),
  warnings: array(object(input).warnings, (warning) => literal(ISSUER_WARNINGS, warning, "warning"), "warnings"),
})

const warningTexts: Readonly<Record<IssuerWarning, string>> = {
  vat_registry_not_checked: "Regimul de TVA sau CIF-ul a fost salvat fără verificare în registrul ANAF: completarea datelor firmelor este oprită pe acest server.",
}

/** The sentence the settings screen shows next to the saved notice, or `undefined` when nothing needs saying. */
export const issuerSaveWarning = (warnings: ReadonlyArray<IssuerWarning>): string | undefined => {
  const [first] = warnings
  return first === undefined ? undefined : warningTexts[first]
}
