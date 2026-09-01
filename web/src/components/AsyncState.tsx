import type { ReactNode } from "react"

import { ApiFailure } from "../api.ts"

export const ErrorAlert = ({ error }: { readonly error: unknown }) => {
  const failure = error instanceof ApiFailure ? error : undefined
  return <div className="alert" role="alert" tabIndex={-1}>
    <strong>Nu am putut finaliza operația.</strong>
    <p>{failure?.message ?? (error instanceof Error ? error.message : "A apărut o eroare neașteptată.")}</p>
    {failure !== undefined && failure.issues.length >= 1 ? <ul>{failure.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
  </div>
}

export const Loading = ({ label = "Se încarcă…" }: { readonly label?: string }) => <div className="center-state" role="status">
  <span className="spinner" aria-hidden="true" /><p>{label}</p>
</div>

export const EmptyState = ({ children }: { readonly children: ReactNode }) => <p className="empty-note">{children}</p>
