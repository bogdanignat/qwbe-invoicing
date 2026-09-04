export const focusAndReveal = (element: HTMLElement | null): void => {
  if (element === null) return
  element.focus()
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  element.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" })
}
