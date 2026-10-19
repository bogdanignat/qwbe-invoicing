import { rangeIssue, type ReportRange } from "./report-period.ts"

/**
 * What the address cannot hold about the custom interval: that it was chosen
 * but not applied yet, the dates being typed and why they were refused. Each is
 * kept with the address (`search`) it was made on, so leaving that address —
 * Back, Forward, another filter — leaves it behind too.
 */
interface OnAddress<Value> {
  readonly on: string
  readonly value: Value
}

export interface CustomRangeState {
  readonly chosen: OnAddress<true> | undefined
  readonly draft: OnAddress<ReportRange> | undefined
  readonly refusal: OnAddress<string> | undefined
}

export const INITIAL_CUSTOM_RANGE: CustomRangeState = { chosen: undefined, draft: undefined, refusal: undefined }

const here = <Value>(entry: OnAddress<Value> | undefined, search: string): Value | undefined =>
  entry?.on === search ? entry.value : undefined

export interface CustomRangeView {
  readonly chosen: boolean
  /** The dates the inputs show: the ones being typed, else the period on screen. */
  readonly range: ReportRange
  readonly error: string | undefined
}

export const customRangeView = (state: CustomRangeState, search: string, applied: ReportRange): CustomRangeView => ({
  chosen: here(state.chosen, search) === true,
  range: here(state.draft, search) ?? applied,
  error: here(state.refusal, search),
})

export const chooseCustomRange = (state: CustomRangeState, search: string): CustomRangeState =>
  ({ ...state, chosen: { on: search, value: true } })

/** Editing a date withdraws an earlier refusal: it was about dates that are no longer there. */
export const editCustomRange = (
  state: CustomRangeState, search: string, shown: ReportRange, field: keyof ReportRange, value: string,
): CustomRangeState => ({ ...state, draft: { on: search, value: { ...shown, [field]: value } }, refusal: undefined })

export type CustomRangeApply =
  | { readonly kind: "apply"; readonly range: ReportRange }
  | { readonly kind: "refused"; readonly state: CustomRangeState }

export const applyCustomRange = (state: CustomRangeState, search: string, shown: ReportRange): CustomRangeApply => {
  const message = rangeIssue(shown)
  return message === undefined
    ? { kind: "apply", range: shown }
    : { kind: "refused", state: { ...state, refusal: { on: search, value: message } } }
}
