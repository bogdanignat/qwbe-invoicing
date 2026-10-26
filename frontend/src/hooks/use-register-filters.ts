import { useMemo, useState } from "react"

import { useDebouncedValue } from "./use-debounced-value.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import type { RegisterKindFilter, RegisterQuery } from "../lib/invoice-register-query.ts"
import { readPageSize, rememberPageSize, type PageSize } from "../lib/register-page-size.ts"
import {
  choosePeriod, editCustomRange, initialRegisterFilters, isNarrowed, registerRange,
} from "../lib/register-filters-state.ts"
import { customRangeIssue, type RegisterPeriod } from "../lib/register-period.ts"
import type { ReportRange } from "../lib/report-period.ts"

/** How long typing (the search, a custom date) has to pause before it becomes a request. */
const TYPING_DEBOUNCE_MS = 300

export interface RegisterFiltersModel {
  /** What the server is asked for: the period resolved, typed values once typing paused. */
  readonly query: RegisterQuery
  /** Whether anything narrows the register, so an empty answer is not read as "nothing issued yet". */
  readonly narrowed: boolean
  readonly period: RegisterPeriod
  /** The dates the custom inputs show, as typed. */
  readonly customRange: ReportRange
  readonly customIssue: string | undefined
  readonly kind: RegisterKindFilter
  readonly search: string
  readonly pageSize: PageSize
  readonly choosePeriod: (period: RegisterPeriod) => void
  readonly editCustom: (field: keyof ReportRange, value: string) => void
  readonly setKind: (kind: RegisterKindFilter) => void
  readonly setSearch: (search: string) => void
  readonly setPageSize: (size: PageSize) => void
}

/**
 * The register's filters, held as state; the rules are in `register-filters-state.ts`.
 *
 * Today is read in Europe/Bucharest, the zone `issue_date` is a date in, as the
 * dashboard does. A preset applies at once; a custom interval waits for typing
 * to pause, like the search. The interval is debounced as one value, so the
 * two ends never travel apart (a new `from` with an old `to` could run
 * backwards), and it keeps its identity while its dates do, so a preset
 * recomputed on every render never restarts the wait.
 */
export const useRegisterFilters = (): RegisterFiltersModel => {
  const [state, setState] = useState(() => initialRegisterFilters(readPageSize()))
  const today = todayIn(ORGANIZATION_TIME_ZONE)
  const resolved = registerRange(state, today)
  const range = useMemo(() => ({ from: resolved.from, to: resolved.to }), [resolved.from, resolved.to])
  const settledRange = useDebouncedValue(range, state.period === "custom" ? TYPING_DEBOUNCE_MS : 0)
  const search = useDebouncedValue(state.search, TYPING_DEBOUNCE_MS).trim()
  return {
    query: { range: settledRange, kind: state.kind, search, limit: state.pageSize },
    narrowed: isNarrowed(settledRange, state.kind, search),
    period: state.period,
    customRange: state.typed,
    customIssue: customRangeIssue(state.typed),
    kind: state.kind,
    search: state.search,
    pageSize: state.pageSize,
    choosePeriod: (period) => { setState((current) => choosePeriod(current, period, todayIn(ORGANIZATION_TIME_ZONE))) },
    editCustom: (field, value) => { setState((current) => editCustomRange(current, field, value)) },
    setKind: (kind) => { setState((current) => ({ ...current, kind })) },
    setSearch: (typed) => { setState((current) => ({ ...current, search: typed })) },
    setPageSize: (pageSize) => {
      rememberPageSize(pageSize)
      setState((current) => ({ ...current, pageSize }))
    },
  }
}
