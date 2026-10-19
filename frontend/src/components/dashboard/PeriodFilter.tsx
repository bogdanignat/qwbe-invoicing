import { useId } from "react"

import { Button } from "../Button.tsx"
import { ChoiceGroup } from "../ui/ChoiceGroup.tsx"
import type { DashboardFiltersModel } from "../../hooks/use-dashboard-filters.ts"
import { PERIOD_CHOICES } from "../../lib/dashboard-query.ts"

/**
 * The period choice: five presets and a custom interval. The custom dates are
 * applied with the button, never per keystroke, so a half-typed date never
 * becomes a request.
 */
export const PeriodFilter = ({ filters }: { readonly filters: DashboardFiltersModel }) => {
  const errorId = useId()
  const refused = filters.customError !== undefined
  const described = refused ? errorId : undefined
  return <div className="filters dashboard-filters">
    <ChoiceGroup legend="Perioada" choices={PERIOD_CHOICES} value={filters.periodChoice} onChange={filters.choosePeriod} />
    {filters.periodChoice === "custom"
      ? <form className="custom-range" noValidate onSubmit={(event) => { event.preventDefault(); filters.applyCustom() }}>
        <label>De la
          <input type="date" value={filters.customRange.from} required aria-invalid={refused} aria-describedby={described}
            onChange={(event) => { filters.editCustom("from", event.target.value) }} />
        </label>
        <label>Până la
          <input type="date" value={filters.customRange.to} required aria-invalid={refused} aria-describedby={described}
            onChange={(event) => { filters.editCustom("to", event.target.value) }} />
        </label>
        <Button type="submit" className="secondary">Aplică intervalul</Button>
        {refused ? <p className="hint warning" id={errorId} role="alert">{filters.customError}</p> : null}
      </form>
      : null}
  </div>
}
