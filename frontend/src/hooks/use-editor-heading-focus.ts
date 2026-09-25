"use client"

import { useEffect, useRef, type RefObject } from "react"

import { focusAndReveal } from "../lib/focus.ts"

/**
 * Moves the keyboard to the editor's heading whenever a different record opens.
 *
 * The ref is owned by the editor itself rather than handed down from the
 * screen: a ref travelling through props is a value the renderer must not read,
 * and the focus belongs to the component that renders the heading anyway.
 *
 * `recordKey` is the record open in the editor — an id, or "new" — so creating
 * a product right after editing one still moves the focus, even though the
 * component never unmounted.
 */
export const useEditorHeadingFocus = (recordKey: string): RefObject<HTMLHeadingElement | null> => {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { focusAndReveal(heading.current) }, [recordKey])
  return heading
}
