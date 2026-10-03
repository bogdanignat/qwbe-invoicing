import { registryFieldId } from "./registry-fields.ts"

/**
 * Moves the keyboard to a heading and brings it into view.
 *
 * The registries open their editor beside a long list: without this, a keyboard
 * user pressing "Edit" on the twentieth row stays at the bottom of the list
 * while the form fills in somewhere above. The scroll follows the user's own
 * motion preference, and the whole thing is a no-op before the node exists.
 *
 * It runs from an effect, which is the one thing an effect is for: a DOM action
 * after a render, not a fetch.
 */
export const focusAndReveal = (element: HTMLElement | null): void => {
  if (element === null) return
  element.focus()
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  element.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" })
}

/**
 * The same move, aimed at a form control by the id `registry-fields.ts` derives.
 *
 * Two callers need it and neither of them holds a ref: the refusal focus, which
 * runs from an effect, and the branding controls, which unmount themselves as
 * the effect of their own click and would otherwise drop the keyboard on
 * `document.body`.
 */
export const focusRegistryField = (form: string, field: string): void => {
  focusAndReveal(document.getElementById(registryFieldId(form, field)))
}
