/**
 * How a refusal is attached to the control that caused it.
 *
 * The model already names the single field that refuses a submit; what the
 * screen owes it is a control the keyboard can be moved to and a message the
 * control points at. Both need stable ids, and deriving them here — rather than
 * writing them out at each field — keeps the three places that must agree (the
 * control's `id`, its `aria-describedby`, the message's `id`) a tested fact
 * instead of three string literals that can drift apart.
 *
 * `aria-invalid` alone announces nothing: a screen reader says "invalid" only
 * when the control is reached, and nothing at all when the refusal appears
 * somewhere below the viewport. The description is what carries the sentence.
 */
export const CUSTOMER_FORM = "customer"
export const PRODUCT_FORM = "product"
export const ISSUER_FORM = "issuer"
export const SERIES_FORM = "series"

export interface RegistryFieldAria {
  readonly id: string
  readonly "aria-invalid": true | undefined
  readonly "aria-describedby": string | undefined
}

export const registryFieldId = (form: string, field: string): string => `${form}-${field}`

export const registryIssueId = (form: string, field: string): string => `${form}-${field}-issue`

/**
 * The attributes one control carries, given the field the last submit refused.
 * Only the refused control is marked and described: an `aria-describedby`
 * pointing at a message that is not rendered would be a dangling reference.
 */
export const registryFieldAria = (
  form: string,
  refused: string | undefined,
) => (field: string): RegistryFieldAria => ({
  id: registryFieldId(form, field),
  "aria-invalid": refused === field ? true : undefined,
  "aria-describedby": refused === field ? registryIssueId(form, field) : undefined,
})
