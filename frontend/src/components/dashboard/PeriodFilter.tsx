import { Button } from "../Button.tsx"
import { DateRangeFields } from "../DateRangeFields.tsx"
import { ChoiceGroup } from "../ui/ChoiceGroup.tsx"
import type { DashboardFiltersModel } from "../../hooks/use-dashboard-filters.ts"
import { PERIOD_CHOICES } from "../../lib/dashboard-query.ts"

/**
 * The period choice: five presets and a custom interval. The custom dates are
 * applied with the button, never per keystroke, so a half-typed date never
 * becomes a request.
 */
export const PeriodFilter = ({ filters }: { readonly filters: DashboardFiltersModel }) =>
  <div className="filters dashboard-filters">
    <ChoiceGroup legend="Perioada" choices={PERIOD_CHOICES} value={filters.periodChoice} onChange={filters.choosePeriod} />
    {filters.periodChoice === "custom"
      ? <form className="custom-range" noValidate onSubmit={(event) => { event.preventDefault(); filters.applyCustom() }}>
        <DateRangeFields range={filters.customRange} error={filters.customError} onEdit={filters.editCustom} required>
          <Button type="submit" className="secondary">Aplică intervalul</Button>
        </DateRangeFields>
      </form>
      : null}
  </div>
