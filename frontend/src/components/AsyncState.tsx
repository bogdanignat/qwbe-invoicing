import type { ReactNode } from "react"

import { Button } from "./Button.tsx"
import { ApiFailure } from "../lib/api-errors.ts"

interface ErrorAlertProps {
  readonly error: unknown
  /** Rendered only when the caller's model decided this failure is worth retrying. */
  readonly onRetry?: (() => void) | undefined
}

export const ErrorAlert = ({ error, onRetry }: ErrorAlertProps) => {
  const failure = error instanceof ApiFailure ? error : undefined
  return <div className="alert" role="alert">
    <strong>Nu am putut finaliza operația.</strong>
    <p>{failure?.message ?? (error instanceof Error ? error.message : "A apărut o eroare neașteptată.")}</p>
    {onRetry === undefined ? null : <p><Button type="button" onClick={onRetry}>Reîncearcă</Button></p>}
  </div>
}

export const Loading = ({ label }: { readonly label: string }) => <div className="center-state" role="status">
  <span className="spinner" aria-hidden="true" /><p>{label}</p>
</div>

export const EmptyState = ({ children }: { readonly children: ReactNode }) =>
  <p className="empty-state">{children}</p>
