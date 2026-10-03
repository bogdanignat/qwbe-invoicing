import type { BrandingImageDraft } from "./issuer-branding.ts"
import type { BrandingImageOutcome } from "./branding-image-file.ts"
import type { RevisionGuard } from "./revision-guard.ts"

/**
 * What to do with an answer that arrived late.
 *
 * Two things on this screen are slow enough to be overtaken by the user: the
 * decoding of a chosen logo, and the save. Both must be filtered, and both for
 * the same reason — the answer describes a state that may no longer be in front
 * of anyone. A second file chosen while the first is still decoding must not be
 * replaced by the first one's result, and a save answer must not overwrite the
 * fields edited while it was in flight.
 *
 * The rules are here, as values over a `RevisionGuard`, so the races are tested
 * without a component, a DOM or a timer: begin a selection, edit, and assert
 * that the outcome is ignored.
 */
export type BrandingSelectionEffect =
  /** The selection was superseded: neither the preview nor the refusal is shown. */
  | { readonly kind: "ignore" }
  | { readonly kind: "image"; readonly draft: BrandingImageDraft }
  | { readonly kind: "issue"; readonly message: string }

export const brandingSelectionEffect = (
  guard: RevisionGuard,
  revision: number,
  outcome: BrandingImageOutcome,
): BrandingSelectionEffect => {
  if (!guard.isCurrent(revision)) return { kind: "ignore" }
  return outcome.kind === "ready"
    ? { kind: "image", draft: outcome.draft }
    : { kind: "issue", message: outcome.message }
}

/**
 * Whether the saved profile may replace the form. `false` is not a failure: the
 * save succeeded and the cache holds the answer — only the fields being typed
 * are left alone, which is what `notice` tells the user.
 */
export const savedFormReplacesEdits = (guard: RevisionGuard, revision: number): boolean =>
  guard.isCurrent(revision)

export const ISSUER_SAVED = "Datele firmei au fost salvate."
export const ISSUER_SAVED_WHILE_EDITING =
  "Datele firmei au fost salvate. Modificările făcute în timpul salvării au rămas în formular."
