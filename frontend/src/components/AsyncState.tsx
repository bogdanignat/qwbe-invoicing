import { ApiFailure } from "../lib/api-errors.ts"

export const ErrorAlert = ({ error }: { readonly error: unknown }) => {
  const failure = error instanceof ApiFailure ? error : undefined
  return <div className="alert" role="alert">
    <strong>Nu am putut finaliza operația.</strong>
    <p>{failure?.message ?? (error instanceof Error ? error.message : "A apărut o eroare neașteptată.")}</p>
  </div>
}

export const Loading = ({ label }: { readonly label: string }) => <div className="center-state" role="status">
  <span className="spinner" aria-hidden="true" /><p>{label}</p>
</div>
