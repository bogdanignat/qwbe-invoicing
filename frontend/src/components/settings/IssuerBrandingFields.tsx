"use client"

import { Button } from "../Button.tsx"
import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "../registry/FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { ISSUER_BRAND_TEXT_MAX_CODE_POINTS } from "../../lib/issuer-branding.ts"
import { ISSUER_FORM, registryFieldId, type RegistryFieldAria } from "../../lib/registry-fields.ts"
import type { IssuerBrandingModel } from "../../hooks/use-issuer-branding.ts"
import type { IssuerField } from "../../lib/issuer-payload.ts"
import type { IssuerSettingsForm } from "../../lib/issuer-form.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface IssuerBrandingFieldsProps {
  readonly form: IssuerSettingsForm
  readonly disabled: boolean
  readonly branding: IssuerBrandingModel
  readonly issue: RegistryEditorIssue<IssuerField> | undefined
  readonly aria: (field: IssuerField) => RegistryFieldAria
  readonly onChange: (patch: Partial<IssuerSettingsForm>) => void
  /** Text and logo in one action; the model clears both. */
  readonly onClearBranding: () => void
}

/**
 * The optional brand on the document: a line of text, a logo, or both.
 *
 * The file input is cleared after every choice so the same file can be chosen
 * again after it was refused — a `change` event does not fire for an unchanged
 * value. Everything the file has to satisfy is decided in the model; what is
 * rendered here is the preview, the refusal and the two ways out of it.
 *
 * A refused file marks the control itself: `role="alert"` announces the sentence
 * once, when it appears, and nothing again to someone who tabs back to the
 * input — so the input is `aria-invalid` and describes itself by that message
 * for as long as it stands, as the legacy screen did.
 */
export const IssuerBrandingFields = (props: IssuerBrandingFieldsProps) => {
  const { branding, disabled, issue, aria } = props
  const image = branding.image
  const imageAria = aria("brandImage")
  const hintId = `${registryFieldId(ISSUER_FORM, "brandImage")}-hint`
  const refusedId = `${registryFieldId(ISSUER_FORM, "brandImage")}-refused`
  const refused = branding.imageIssue !== undefined
  return <fieldset className="branding-fields">
    <legend>Brand documente <span className="optional">opțional</span></legend>
    <div className="form-grid">
      <Field label="Text de brand" optional className="span-two">
        <Input disabled={disabled} value={props.form.brandText} {...aria("brandText")}
          maxLength={ISSUER_BRAND_TEXT_MAX_CODE_POINTS}
          onChange={(event) => { props.onChange({ brandText: event.currentTarget.value }) }} />
        <FieldIssue issue={issue} field="brandText" form={ISSUER_FORM} />
      </Field>
    </div>
    <Field label="Siglă PNG sau JPEG" optional htmlFor={registryFieldId(ISSUER_FORM, "brandImage")}>
      <input type="file" className="control" accept="image/png,image/jpeg" disabled={disabled} {...imageAria}
        aria-invalid={refused ? true : imageAria["aria-invalid"]}
        aria-describedby={[hintId, imageAria["aria-describedby"], refused ? refusedId : undefined]
          .filter(Boolean).join(" ")}
        onChange={(event) => {
          branding.select(event.currentTarget.files?.[0])
          event.currentTarget.value = ""
        }} />
    </Field>
    <p className="hint" id={hintId}>
      Maximum 256 KiB, 2048 px pe axă și 4 megapixeli.
    </p>
    <FieldIssue issue={issue} field="brandImage" form={ISSUER_FORM} />
    {branding.imageIssue === undefined
      ? null
      : <p className="hint warning" role="alert" id={refusedId}>{branding.imageIssue} <Button className="secondary small"
        onClick={branding.discardRefused}>Renunță la fișierul respins</Button></p>}
    {branding.pending ? <p className="status-note" role="status">Se validează imaginea…</p> : null}
    {image === null
      ? null
      : <div className="branding-preview">
        <img src={image.previewUrl} alt="Sigla curentă" width={image.width} height={image.height} />
        <Button className="secondary small" disabled={disabled} onClick={branding.remove}>Elimină sigla</Button>
      </div>}
    {props.form.brandText === "" && image === null
      ? null
      : <Button className="danger small" disabled={disabled}
        onClick={props.onClearBranding}>Elimină tot brandingul</Button>}
  </fieldset>
}
