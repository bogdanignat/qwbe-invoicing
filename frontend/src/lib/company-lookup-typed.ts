/**
 * What the user did in one form's company lookup, as a pure reducer.
 *
 * Only typing counts: the CUI and the name typed, the suggestion picked, the
 * proposal copied in. The state belongs to a `scope` (the customer edited, the
 * party type); read under another scope it is empty, so switching customer or
 * party type drops what was typed in the same render and nothing typed before
 * can still be asked.
 */
export interface TypedLookup {
  readonly scope: string
  readonly cui: string
  readonly name: string
  /** A suggestion's CUI: looked up at once, without the typing wait. */
  readonly picked: string | undefined
  /** The CUI whose proposal was copied into the form: not offered again until the CUI is typed anew. */
  readonly applied: string | undefined
}

export type TypedAction =
  | { readonly kind: "type-cui"; readonly value: string }
  | { readonly kind: "type-name"; readonly value: string }
  | { readonly kind: "pick"; readonly cui: string }
  | { readonly kind: "close-suggestions" }
  | { readonly kind: "applied"; readonly cui: string }

export const freshTyped = (scope: string): TypedLookup =>
  ({ scope, cui: "", name: "", picked: undefined, applied: undefined })

export const typedForScope = (state: TypedLookup, scope: string): TypedLookup =>
  state.scope === scope ? state : freshTyped(scope)

export const reduceTyped = (state: TypedLookup, scope: string, action: TypedAction): TypedLookup => {
  const current = typedForScope(state, scope)
  switch (action.kind) {
    case "type-cui": return { ...current, cui: action.value, picked: undefined, applied: undefined }
    case "type-name": return { ...current, name: action.value }
    case "pick": return { ...current, picked: action.cui, name: "", applied: undefined }
    case "close-suggestions": return current.name === "" ? current : { ...current, name: "" }
    case "applied": return { ...current, applied: action.cui, name: "" }
  }
}

/** The CUI to look up: a picked suggestion's at once, otherwise the typed one once it has settled. */
export const lookupTarget = (typed: TypedLookup, settledCui: string | undefined): string | undefined =>
  typed.picked ?? settledCui
