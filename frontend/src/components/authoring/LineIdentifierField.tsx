import { useState } from "react"
import { Field } from "../ui/Field.tsx"
import { Input } from "../ui/Input.tsx"

interface LineIdentifierFieldProps {
  readonly label: string
  readonly id: string
  readonly value: string
  /** The refusal `lib/item-identifiers.ts` named for the typed value, or `null`. */
  readonly issue: string | null
  readonly maxLength: number
  readonly numeric?: boolean
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}

/**
 * The article code or the EAN of a document line: optional, clearable, and
 * refused at the field in Romanian. The custom validity holds back the form's
 * submit (the draft save) the same way a blank required field does. The message
 * waits for the first blur (or a refused submit), so it never scolds mid-typing;
 * after that it follows the value.
 */
export const LineIdentifierField = (props: LineIdentifierFieldProps) => {
  const issueId = `${props.id}-issue`
  const [touched, setTouched] = useState(false)
  const shown = touched ? props.issue : null
  return <Field label={props.label}>
    <Input disabled={props.disabled} value={props.value} maxLength={props.maxLength}
      inputMode={props.numeric === true ? "numeric" : undefined}
      ref={(input) => { input?.setCustomValidity(props.issue ?? "") }}
      aria-invalid={shown === null ? undefined : true} aria-describedby={shown === null ? undefined : issueId}
      onBlur={() => { setTouched(true) }} onInvalid={() => { setTouched(true) }}
      onChange={(event) => { props.onChange(event.currentTarget.value) }} />
    {shown === null ? null : <p className="hint warning" id={issueId}>{shown}</p>}
  </Field>
}
