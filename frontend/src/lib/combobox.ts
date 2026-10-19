/**
 * The keyboard and ARIA rules of an editable combobox with a list popup
 * (WAI-ARIA APG, "Editable Combobox With List Autocomplete"), apart from the
 * component so they can be tested without a DOM.
 *
 * Focus stays in the input; the active option is announced through
 * `aria-activedescendant`. `-1` is "no active option". The arrows wrap, Enter
 * picks the active option only, Escape closes the list. Every other key is the
 * input's own (Home and End move the caret, as in any text field).
 */
export type ComboboxKeyAction =
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "pick"; readonly index: number }
  | { readonly kind: "close" }
  | { readonly kind: "none" }

export const comboboxKey = (key: string, active: number, count: number): ComboboxKeyAction => {
  if (count === 0) return { kind: "none" }
  if (key === "ArrowDown") return { kind: "move", index: active < 0 || active >= count - 1 ? 0 : active + 1 }
  if (key === "ArrowUp") return { kind: "move", index: active <= 0 || active >= count ? count - 1 : active - 1 }
  if (key === "Enter" && active >= 0 && active < count) return { kind: "pick", index: active }
  if (key === "Escape") return { kind: "close" }
  return { kind: "none" }
}

export const comboboxOptionId = (listboxId: string, index: number): string => `${listboxId}-option-${String(index)}`

export interface ComboboxInputAria {
  readonly role: "combobox"
  readonly "aria-autocomplete": "list"
  readonly "aria-expanded": boolean
  readonly "aria-controls": string
  readonly "aria-activedescendant": string | undefined
}

export const comboboxInputAria = (listboxId: string, count: number, active: number): ComboboxInputAria => ({
  role: "combobox",
  "aria-autocomplete": "list",
  "aria-expanded": count > 0,
  "aria-controls": listboxId,
  "aria-activedescendant": count > 0 && active >= 0 && active < count ? comboboxOptionId(listboxId, active) : undefined,
})

export type ComboboxInputAttributes = (ComboboxInputAria & { readonly autoComplete: "off" }) | Readonly<Record<never, never>>

/**
 * What the input carries. Suggesting, it is a combobox and the browser's own
 * autofill list is turned off so the two never overlap; not suggesting (no name
 * search, an individual, the plugin off) it carries nothing extra and is the
 * plain text input it was before — the same element either way, so the focus
 * and the caret stay when suggestions are switched on or off.
 */
export const comboboxInputAttributes = (suggest: boolean, listboxId: string, count: number, active: number): ComboboxInputAttributes =>
  suggest ? { ...comboboxInputAria(listboxId, count, active), autoComplete: "off" } : {}

export interface ComboboxOptionAria {
  readonly id: string
  readonly role: "option"
  readonly "aria-selected": boolean
}

export const comboboxOptionAria = (listboxId: string, index: number, active: number): ComboboxOptionAria => ({
  id: comboboxOptionId(listboxId, index),
  role: "option",
  "aria-selected": index === active,
})
