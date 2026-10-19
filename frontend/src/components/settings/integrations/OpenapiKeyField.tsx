import { Button } from "../../Button.tsx"
import { Field } from "../../ui/Field.tsx"
import { Input } from "../../ui/Input.tsx"
import type { OpenapiKeyEditor } from "../../../hooks/use-company-lookup-settings.ts"
import { useFocusOnReturn } from "../../../hooks/use-focus-on-return.ts"
import { keyStatus, type CompanyLookupSettings } from "../../../lib/company-lookup-settings.ts"

interface OpenapiKeyFieldProps {
  readonly settings: CompanyLookupSettings
  readonly editor: OpenapiKeyEditor
  readonly disabled: boolean
}

/**
 * The openapi.ro key, write-only: once stored it is shown only by its last four
 * characters, and replaced or deleted, never read back into the field.
 */
export const OpenapiKeyField = ({ settings, editor, disabled }: OpenapiKeyFieldProps) => {
  // "Renunță" and a saved replacement both close the field: the keyboard goes back to "Înlocuiește".
  const replaceButton = useFocusOnReturn<HTMLButtonElement>(!editor.editing, !disabled)
  return <div className="grid gap-3">
  <h3>Cheia openapi.ro</h3>
  <p className="hint">{keyStatus(settings)}</p>
  {editor.editing ? <KeyForm editor={editor} disabled={disabled} /> : <div className="button-row">
    <Button ref={replaceButton} className="secondary small" disabled={disabled} onClick={editor.startReplace}>
      Înlocuiește<span className="sr-only"> cheia openapi.ro</span>
    </Button>
    <Button className="danger small" disabled={disabled} onClick={editor.clear}>
      Șterge<span className="sr-only"> cheia openapi.ro</span>
    </Button>
  </div>}
  {settings.provider === "openapi" && !editor.editing
    ? <p className="hint">Ștergerea cheii oprește și openapi.ro.</p>
    : null}
  </div>
}

const KeyForm = ({ editor, disabled }: { readonly editor: OpenapiKeyEditor; readonly disabled: boolean }) =>
  <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); editor.save() }}>
    <Field label={editor.replacing ? "Cheie nouă" : "Cheie"} required>
      <Input type="password" required disabled={disabled} value={editor.draft} autoComplete="off"
        spellCheck={false} autoFocus={editor.replacing}
        onChange={(event) => { editor.change(event.currentTarget.value) }} />
    </Field>
    <p className="hint">Cheia se păstrează criptată pe server și nu mai poate fi afișată după salvare.</p>
    <div className="button-row">
      <Button className="secondary" type="submit" disabled={disabled}>{disabled ? "Se salvează…" : "Salvează cheia"}</Button>
      {editor.replacing ? <Button className="secondary" disabled={disabled} onClick={editor.cancelReplace}>Renunță</Button> : null}
    </div>
  </form>
