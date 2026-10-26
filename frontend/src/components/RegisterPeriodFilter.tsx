import { useId } from "react"

import { DateRangeFields } from "./DateRangeFields.tsx"
import { Field } from "./ui/Field.tsx"
import { Select } from "./ui/Select.tsx"
import type { RegisterFiltersModel } from "../hooks/use-register-filters.ts"
import { EARLIEST_REGISTER_DATE, REGISTER_PERIODS, registerPeriodFrom } from "../lib/register-period.ts"

/**
 * The period as a select of presets; the last one, the custom interval, is the
 * only one that shows date inputs. An empty date leaves that end open, and the
 * dates are asked for once typing pauses and they are whole (`register-period.ts`).
 */
export const RegisterPeriodFilter = ({ filters }: { readonly filters: RegisterFiltersModel }) => {
  const periodId = useId()
  return <>
    <Field label="Perioada" htmlFor={periodId}>
      <Select id={periodId} value={filters.period} onChange={(event) => {
        const period = registerPeriodFrom(event.target.value)
        if (period !== undefined) filters.choosePeriod(period)
      }}>
        {REGISTER_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
      </Select>
    </Field>
    {filters.period === "custom"
      ? <div className="custom-range">
        <DateRangeFields range={filters.customRange} error={filters.customIssue} onEdit={filters.editCustom}
          hint="Lista se actualizează când datele sunt complete." min={EARLIEST_REGISTER_DATE} />
      </div>
      : null}
  </>
}
