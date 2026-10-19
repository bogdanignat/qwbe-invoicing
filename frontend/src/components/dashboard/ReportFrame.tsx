import type { ReactNode } from "react"

import { ErrorAlert, Loading } from "../AsyncState.tsx"
import type { ReportBlock } from "../../hooks/use-dashboard.ts"

interface ReportFrameProps<Report, View> {
  readonly block: ReportBlock<Report, View>
  readonly loading: string
  readonly children: (view: View) => ReactNode
}

/**
 * A report's three states: loading, failed before any answer, answered. A
 * refresh that fails after an answer keeps the answer on screen under the alert.
 */
export const ReportFrame = <Report, View>({ block, loading, children }: ReportFrameProps<Report, View>) => {
  const { state, view } = block
  if (view === undefined) {
    return state.isPending ? <Loading label={loading} /> : <ErrorAlert error={state.error} onRetry={state.retry} />
  }
  return <>
    {state.error === null ? null : <ErrorAlert error={state.error} onRetry={state.retry} />}
    {children(view)}
  </>
}
