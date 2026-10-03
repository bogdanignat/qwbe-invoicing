"use client"

import { useState } from "react"

/**
 * The editor half of a master-data screen: which record is open, the form being
 * typed, and the single field that refused the last submit.
 *
 * Both registries share it because both work the same way — a list on the left
 * opens a record on the right, a new one opens an empty form, and a refusal is
 * a value the screen focuses rather than a browser dialog. The form shape and
 * every rule over it stay in `lib`; this holds the state and nothing else.
 *
 * Editing is one piece of state rather than an id plus a form: a form belonging
 * to a record that is no longer open cannot exist, so it cannot be rendered.
 */
export interface RegistryEditorIssue<Field extends string> {
  readonly field: Field
  readonly message: string
}

export interface RegistryEditorState<Form> {
  /** Absent while creating; the editor itself is closed when `form` is absent. */
  readonly id: string | undefined
  readonly form: Form
}

export interface RegistryEditor<Form, Field extends string> {
  readonly editing: RegistryEditorState<Form> | undefined
  readonly issue: RegistryEditorIssue<Field> | undefined
  readonly open: (id: string | undefined, form: Form) => void
  readonly close: () => void
  readonly change: (patch: Partial<Form>) => void
  /** A transition that reads the current form: switching party type, choosing a county. */
  readonly apply: (next: (form: Form) => Form) => void
  readonly refuse: (issue: RegistryEditorIssue<Field>) => void
  /** Closes the editor if it holds the record named — used after a deletion. */
  readonly closeRecord: (id: string) => void
}

export const useRegistryEditor = <Form, Field extends string>(): RegistryEditor<Form, Field> => {
  const [editing, setEditing] = useState<RegistryEditorState<Form> | undefined>(undefined)
  const [issue, setIssue] = useState<RegistryEditorIssue<Field> | undefined>(undefined)
  const edit = (next: (current: RegistryEditorState<Form>) => RegistryEditorState<Form>): void => {
    // Typing answers the refusal: the message goes with the keystroke that may
    // have fixed it, instead of outliving the field it pointed at.
    setIssue(undefined)
    setEditing((current) => current === undefined ? current : next(current))
  }
  return {
    editing,
    issue,
    open: (id, form) => { setIssue(undefined); setEditing({ id, form }) },
    close: () => { setIssue(undefined); setEditing(undefined) },
    change: (patch) => { edit((current) => ({ ...current, form: { ...current.form, ...patch } })) },
    apply: (next) => { edit((current) => ({ ...current, form: next(current.form) })) },
    refuse: (value) => { setIssue(value) },
    closeRecord: (id) => { setEditing((current) => current?.id === id ? undefined : current) },
  }
}
