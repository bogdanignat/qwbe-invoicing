"use client"

import { useRef, type RefObject } from "react"

/**
 * A native modal dialog, opened from a button and closed back onto it.
 *
 * `showModal` is what makes the dialog modal: the browser puts it in the top
 * layer, marks everything behind it inert and keeps Tab inside it, which is a
 * focus trap no listener of ours has to maintain. What it does not guarantee
 * across engines is where the keyboard lands afterwards, so the element that
 * opened the dialog is remembered and focused again when it closes — otherwise a
 * keyboard user is returned to the top of the document, several sections above
 * the field they were reading about.
 *
 * `open` is a DOM call from an event handler, not an effect: the dialog is
 * opened because a button was pressed, not because the screen rendered.
 */
export interface HelpDialogActions {
  readonly open: () => void
  /** Bound to the dialog's own `close` event, which fires for Escape too. */
  readonly restoreFocus: () => void
}

/**
 * The ref travels on its own rather than inside the model: a component may hand
 * a ref to an element, but reading anything off an object that holds one during
 * render is what the ref rule refuses.
 */
export const useHelpDialog = (): readonly [RefObject<HTMLDialogElement | null>, HelpDialogActions] => {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  return [dialog, {
    open: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.current?.showModal()
    },
    restoreFocus: () => { opener.current?.focus() },
  }]
}
