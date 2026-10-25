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
 * submit (the draft save) the same way a blank required field does.
 */
export const LineIdentifierField = (props: LineIdentifierFieldProps) => {
  const issueId = `${props.id}-issue`
  return <Field label={props.label}>
    <Input disabled={props.disabled} value={props.value} maxLength={props.maxLength}
      inputMode={props.numeric === true ? "numeric" : undefined}
      ref={(input) => { input?.setCustomValidity(props.issue ?? "") }}
      aria-invalid={props.issue === null ? undefined : true} aria-describedby={props.issue === null ? undefined : issueId}
      onChange={(event) => { props.onChange(event.currentTarget.value) }} />
    {props.issue === null ? null : <p className="hint warning" id={issueId}>{props.issue}</p>}
  </Field>
}
