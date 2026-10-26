import type { RegisterKindFilter } from "./invoice-register-query.ts"
import type { PageSize } from "./register-page-size.ts"
import {
  DEFAULT_REGISTER_PERIOD, OPEN_RANGE, isSendableRange, presetDateRange, type RegisterPeriod,
} from "./register-period.ts"
import type { ReportRange } from "./report-period.ts"

/**
 * The register's filters as plain state and the transitions between them, so
 * every rule is a function a test can call; `use-register-filters.ts` only holds
 * the state and debounces what it sends.
 *
 * `typed` is what the custom inputs show; `applied` is the last typed interval
 * that could be sent. A half-typed or backwards interval changes `typed` only,
 * so the register keeps answering the last one that made sense.
 */
export interface RegisterFiltersState {
  readonly period: RegisterPeriod
  readonly typed: ReportRange
  readonly applied: ReportRange
  readonly kind: RegisterKindFilter
  readonly search: string
  readonly pageSize: PageSize
}

export const initialRegisterFilters = (pageSize: PageSize): RegisterFiltersState => ({
  period: DEFAULT_REGISTER_PERIOD, typed: OPEN_RANGE, applied: OPEN_RANGE, kind: "all", search: "", pageSize,
})

/** The dates the register is asked for under the current period. */
export const registerRange = (state: RegisterFiltersState, today: string): ReportRange =>
  state.period === "custom" ? state.applied : presetDateRange(state.period, today)

/** Choosing the custom interval starts from the dates on screen, so the list does not jump. */
export const choosePeriod = (state: RegisterFiltersState, period: RegisterPeriod, today: string): RegisterFiltersState => {
  if (period !== "custom" || state.period === "custom") return { ...state, period }
  const current = registerRange(state, today)
  return { ...state, period, typed: current, applied: current }
}

export const editCustomRange = (
  state: RegisterFiltersState, field: keyof ReportRange, value: string,
): RegisterFiltersState => {
  const typed = { ...state.typed, [field]: value }
  return { ...state, typed, applied: isSendableRange(typed) ? typed : state.applied }
}

/** Whether anything narrows the register, so an empty answer is not read as "nothing issued yet". */
export const isNarrowed = (range: ReportRange, kind: RegisterKindFilter, search: string): boolean =>
  range.from !== "" || range.to !== "" || kind !== "all" || search.trim() !== ""
