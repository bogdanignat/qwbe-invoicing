"use client"

import { useEffect } from "react"

import { focusAndReveal } from "../lib/focus.ts"
import { registryFieldId } from "../lib/registry-fields.ts"

/**
 * Moves the keyboard to the control a submit just refused.
 *
 * Without it a refusal is silent: the native validation passed, nothing moves,
 * and the sentence appears under a control that may be below the fold — a
 * screen reader user gets no signal that the save was refused at all. The move
 * is what the refusal is worth: the caret lands in the field to correct, and
 * the description the control names is read out with it.
 *
 * It runs from an effect because it is a DOM action after a render — the
 * message must exist before the control that points at it takes focus. The
 * control is found by the id `registry-fields.ts` derives, so no ref has to
 * travel through props to every field of two editors.
 */
export const useRefusedFieldFocus = (form: string, refused: string | undefined): void => {
  useEffect(() => {
    if (refused === undefined) return
    focusAndReveal(document.getElementById(registryFieldId(form, refused)))
  }, [form, refused])
}
