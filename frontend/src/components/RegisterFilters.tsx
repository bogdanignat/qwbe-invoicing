import { useId } from "react"

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

/**
 * The kind choice is a radio group, not a select: three mutually exclusive
 * options, each reachable with one key press and announced as a group.
 */
export const RegisterFilters = ({ filter, onKindChange, onSearchChange }: RegisterFiltersProps) => {
  const searchId = useId()
  const groupName = useId()
  return <div className="filters">
    <fieldset className="filter-kinds">
      <legend>Tip document</legend>
      {kinds.map((kind) => <label key={kind.value} className="filter-choice">
        <input
          type="radio"
          name={groupName}
          value={kind.value}
          checked={filter.kind === kind.value}
          onChange={() => { onKindChange(kind.value) }}
        />
        {kind.label}
      </label>)}
    </fieldset>
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
