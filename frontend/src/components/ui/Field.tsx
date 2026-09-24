import type { ReactNode } from "react"

interface FieldProps {
  /** The label text; markers like "obligatorie" are stated by the caller as part of it or via the flags. */
  readonly label: ReactNode
  readonly required?: boolean
  readonly optional?: boolean
  readonly children: ReactNode
  readonly className?: string
  readonly htmlFor?: string
}

/**
 * A labelled form control on the shared design tokens: one place for the label
 * text, its optional/required marker and the wrapping layout class, so a field
 * reads the same everywhere the authoring form is built.
 */
export const Field = ({ label, required = false, optional = false, children, className, htmlFor }: FieldProps) =>
  <label className={["field", className].filter(Boolean).join(" ")} htmlFor={htmlFor}>
    <span className="field-label">
      {label}
      {optional ? <span className="optional"> opțional</span> : null}
      {required ? <span className="required"> obligatoriu</span> : null}
    </span>
    {children}
  </label>
