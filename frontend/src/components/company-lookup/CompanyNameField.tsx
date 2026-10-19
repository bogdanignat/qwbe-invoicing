"use client"

import { useId, type ReactNode, type RefObject } from "react"

import { Combobox } from "../ui/Combobox.tsx"
import { Field } from "../ui/Field.tsx"
import type { CompanyLookupModel } from "../../hooks/use-company-lookup.ts"
import type { CompanySuggestion } from "../../lib/company-lookup-model.ts"
import { suggestionLabel } from "../../lib/company-proposal-view.ts"
import type { RegistryFieldAria } from "../../lib/registry-fields.ts"

interface CompanyNameFieldProps {
  readonly lookup: CompanyLookupModel
  /** Where the focus returns after "Completează". */
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly maxLength: number
  /** The registry forms' id and refusal description; the one-time buyer has none. */
  readonly controlAria?: RegistryFieldAria
  readonly onChange: (value: string) => void
  /** The refusal under the field, when the form has one. */
  readonly children?: ReactNode
}

const suggestionKey = (suggestion: CompanySuggestion): string => suggestion.cui

/**
 * The name of a party. With a provider that searches by name (openapi.ro) it
 * offers matching companies as the user types; picking one looks its CUI up and
 * shows the proposal card. Otherwise it is a plain text input with no combobox
 * attributes. Either way it is the same element, so turning the search on or
 * off never takes the focus or the caret away.
 */
export const CompanyNameField = ({ lookup, inputRef, label, value, disabled, maxLength, controlAria, onChange, children }: CompanyNameFieldProps) => {
  const labelId = useId()
  return <Field label={label} required labelId={labelId}>
    <Combobox {...controlAria} ref={inputRef} required disabled={disabled} value={value} maxLength={maxLength}
      aria-labelledby={labelId} suggest={lookup.nameSearch} options={lookup.suggestions} optionKey={suggestionKey}
      optionLabel={suggestionLabel} listLabel="Firme sugerate" onPick={lookup.pick} onClose={lookup.closeSuggestions}
      onChange={(event) => { onChange(event.currentTarget.value); lookup.typeName(event.currentTarget.value) }} />
    {lookup.searchNote === undefined ? null : <span className="hint" role="status">{lookup.searchNote}</span>}
    {children}
  </Field>
}
