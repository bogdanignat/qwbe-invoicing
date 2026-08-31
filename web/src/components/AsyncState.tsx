import type { ReactNode } from "react"

import { ApiFailure } from "../api.ts"

const messages: Readonly<Record<string, string>> = {
  customer_has_open_drafts: "Clientul are drafturi deschise.",
  invoice_already_sent_to_anaf: "Factura a fost deja transmisă în RO e-Factura și nu poate fi ștearsă.",
  invoice_has_corrections: "Factura are documente de corecție și nu poate fi ștearsă.",
  invoice_has_payments: "Factura are plăți înregistrate și nu poate fi ștearsă.",
  invoice_already_corrected: "Factura are deja un document storno integral.",
  only_last_invoice_can_be_deleted: "Poți șterge doar ultima factură emisă din serie.",
}

export const ErrorAlert = ({ error }: { readonly error: unknown }) => {
  const failure = error instanceof ApiFailure ? error : undefined
  const message = failure?.code === undefined ? failure?.message : messages[failure.code] ?? failure.message
  return <div className="alert" role="alert" tabIndex={-1}>
    <strong>Nu am putut finaliza operația.</strong>
    <p>{message ?? (error instanceof Error ? error.message : "A apărut o eroare neașteptată.")}</p>
    {failure !== undefined && failure.issues.length >= 1 ? <ul>{failure.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
  </div>
}

export const Loading = ({ label = "Se încarcă…" }: { readonly label?: string }) => <div className="center-state" role="status">
  <span className="spinner" aria-hidden="true" /><p>{label}</p>
</div>

export const EmptyState = ({ children }: { readonly children: ReactNode }) => <p className="empty-note">{children}</p>
