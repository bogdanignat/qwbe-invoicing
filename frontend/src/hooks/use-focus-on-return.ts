"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * Gives the keyboard back to a control when it reappears: a button that opened
 * a field and was replaced by it gets the focus again when the field closes,
 * instead of leaving it on `document.body`. Not on the first render, so a
 * screen that opens with the control already shown does not steal the focus.
 *
 * `ready` is whether the control can take the focus: a field closed by a
 * successful save reappears while the write still reads as pending, and a
 * disabled button refuses `focus()`, so the focus is owed until it is enabled.
 */
export const useFocusOnReturn = <Element extends HTMLElement>(shown: boolean, ready: boolean): RefObject<Element | null> => {
  const element = useRef<Element>(null)
  const wasShown = useRef(shown)
  const owed = useRef(false)
  useEffect(() => {
    owed.current = shown && (owed.current || !wasShown.current)
    wasShown.current = shown
    if (!owed.current || !ready || element.current === null) return
    element.current.focus()
    owed.current = false
  }, [shown, ready])
  return element
}
