import { useState } from "react"

import type { VatRate } from "../../lib/models.ts"
import { presetVatIssue, presetVatOptions } from "../../lib/product-preset-vat.ts"

interface PresetVatSelectProps {
  readonly rates: ReadonlyArray<VatRate>
  readonly saved: string | undefined
  readonly selected: string
  readonly onSelect: (code: string) => void
}

// Controlled: the shown option, the warning and the submitted value all come from `selected`, which
// always has an option of its own, so a choice that stops being in force stays visible and blocked.
export const PresetVatSelect = ({ rates, saved, selected, onSelect }: PresetVatSelectProps) => {
  const issue = presetVatIssue(selected, rates)
  return <>
    <label>Cotă TVA preferată<select name="preferredVatRateCode" value={selected} aria-invalid={issue !== null} aria-describedby="preset-vat-status" onChange={(event) => { onSelect(event.currentTarget.value) }}>{presetVatOptions(rates, [saved, selected]).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
    <p id="preset-vat-status" className={issue === null ? "hint left" : "status-note warning"} aria-live="polite">{issue ?? "Se aplică pe linie doar dacă emitentul e plătitor de TVA la data documentului; altfel linia primește cota implicită."}</p>
  </>
}

interface PresetVatFieldProps {
  readonly rates: ReadonlyArray<VatRate>
  readonly saved: string | undefined
}

// The product form remounts for every edited product and after every save, so the choice always
// starts from the saved preference.
export const PresetVatField = ({ rates, saved }: PresetVatFieldProps) => {
  const [selected, setSelected] = useState(saved ?? "")
  return <PresetVatSelect rates={rates} saved={saved} selected={selected} onSelect={setSelected} />
}
