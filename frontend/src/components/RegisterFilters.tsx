import { useId } from "react"

import { PageSizeSelect } from "./PageSizeSelect.tsx"
import { RegisterPeriodFilter } from "./RegisterPeriodFilter.tsx"
import { ChoiceGroup } from "./ui/ChoiceGroup.tsx"
import { Input } from "./ui/Input.tsx"
import type { RegisterFiltersModel } from "../hooks/use-register-filters.ts"
import { SEARCH_MAX_LENGTH, type RegisterKindFilter } from "../lib/invoice-register-query.ts"

const kinds: ReadonlyArray<{ readonly value: RegisterKindFilter; readonly label: string }> = [
  { value: "all", label: "Toate" },
  { value: "invoice", label: "Facturi" },
  { value: "correction", label: "Storno" },
]

export const RegisterFilters = ({ filters }: { readonly filters: RegisterFiltersModel }) => {
  const searchId = useId()
  return <div className="filters">
    <RegisterPeriodFilter filters={filters} />
    <ChoiceGroup legend="Tip document" choices={kinds} value={filters.kind} onChange={filters.setKind} />
    <div className="filter-search">
      <label htmlFor={searchId}>Caută după număr sau client</label>
      <Input
        id={searchId}
        type="search"
        value={filters.search}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="ex. FCT 12 sau Alpha"
        onChange={(event) => { filters.setSearch(event.target.value) }}
      />
    </div>
    <PageSizeSelect value={filters.pageSize} onChange={filters.setPageSize} />
  </div>
}
