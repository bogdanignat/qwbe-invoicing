import { Effect } from "effect"

import type { Authorize, OperationDependencies } from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import { reportPeriodIssues, revenueReport, type ReportPeriod, type RevenueReport } from "../domain/reports.ts"
import type { CorrectionWork } from "./ports.ts"

/** Revenue per month: issued invoices plus their corrections, which carry their own negative sign. */
export const createRevenueReportOperations = (
  dependencies: OperationDependencies<CorrectionWork>, permissions: InvoicingPermissions, authorize: Authorize,
) => {
  const getRevenueReport = (period: ReportPeriod): Effect.Effect<RevenueReport, InvoicingFailure> => Effect.gen(function*() {
    const issues = reportPeriodIssues(period)
    if (issues.length > 0) return yield* Effect.fail(new ValidationFailure({ issues }))
    const context = yield* authorize(permissions.read)
    const aggregate = yield* dependencies.store.transaction((transaction) =>
      transaction.aggregateRevenue(context.organization.id, period))
    return revenueReport(period, aggregate)
  })
  return { getRevenueReport }
}
export type RevenueReportOperations = ReturnType<typeof createRevenueReportOperations>
