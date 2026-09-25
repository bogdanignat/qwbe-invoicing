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
