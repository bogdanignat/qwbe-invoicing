import { useId } from "react"

import { ChoiceGroup } from "./ui/ChoiceGroup.tsx"
import type { RegisterFilter, RegisterKindFilter } from "../lib/invoice-register-projection.ts"

const kinds: ReadonlyArray<{ readonly value: RegisterKindFilter; readonly label: string }> = [
  { value: "all", label: "Toate" },
  { value: "invoice", label: "Facturi" },
  { value: "correction", label: "Storno" },
]

interface RegisterFiltersProps {
  readonly filter: RegisterFilter
  readonly onKindChange: (kind: RegisterKindFilter) => void
  readonly onSearchChange: (search: string) => void
}

export const RegisterFilters = ({ filter, onKindChange, onSearchChange }: RegisterFiltersProps) => {
  const searchId = useId()
  return <div className="filters">
    <ChoiceGroup legend="Tip document" choices={kinds} value={filter.kind} onChange={onKindChange} />
    <div className="filter-search">
      <label htmlFor={searchId}>Caută după număr sau client</label>
      <input
        id={searchId}
        type="search"
        value={filter.search}
        placeholder="ex. FAC 12 sau Alpha"
        onChange={(event) => { onSearchChange(event.target.value) }}
      />
    </div>
  </div>
}
