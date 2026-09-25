import { registryIssueId } from "../../lib/registry-fields.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface FieldIssueProps<Field extends string> {
  readonly issue: RegistryEditorIssue<Field> | undefined
  readonly field: Field
  /** The form the field belongs to, so the message id matches the control's description. */
  readonly form: string
}

/**
 * The refusal a submit produced, shown under the field it names and nowhere
 * else. The model decides which field is wrong and what to say; this only
 * places the sentence — with the id the control describes itself by, and as a
 * live region, so it is announced when it appears rather than only when the
 * field is reached.
 */
export const FieldIssue = <Field extends string>({ issue, field, form }: FieldIssueProps<Field>) =>
  issue?.field === field
    ? <p id={registryIssueId(form, field)} role="alert" className="hint warning">{issue.message}</p>
    : null
