import type { EFacturaConnectionStatus } from "./efactura-connection.ts"
import type { EFacturaHistory, EFacturaSubmission, SubmittedKind } from "./efactura-submissions.ts"
import { waitReason } from "./efactura-wait-codes.ts"
import type { EFacturaStatus } from "./invoice-register.ts"
import { badgeClass, eFacturaStatusLabel, eFacturaStatusTone } from "./invoice-register-projection.ts"

/**
 * What a document's e-Factura panel shows and allows, decided from the
 * document's submission history and the ANAF connection. Sending is always
 * manual and per document: the button only ever submits the document it sits
 * on, and only while nothing is live or unexplained at ANAF.
 */
export const documentStatus = (current: EFacturaSubmission | null): EFacturaStatus => {
  if (current === null) return "not_sent"
  const { state } = current
  return state === "validating" || state === "uploading" ? "processing" : state
}

export const EFACTURA_POLL_MS = 12_000
export const ARCHIVE_POLL_MS = 60_000

/**
 * How often the history is read again: closely while ANAF has not decided,
 * rarely while only its answer ZIP is still being fetched, never after.
 */
export const historyPollInterval = (history: EFacturaHistory | undefined): number | false => {
  const current = history?.current ?? null
  if (current === null) return false
  const status = documentStatus(current)
  if (status === "queued" || status === "processing") return EFACTURA_POLL_MS
  return current.archiveState === "pending" ? ARCHIVE_POLL_MS : false
}

/** The connection as the panel knows it: its status, still being read, or a read that failed. */
export type ConnectionRead = EFacturaConnectionStatus | "loading" | "unreadable"

export interface EFacturaPanelView {
  readonly status: EFacturaStatus
  readonly badgeLabel: string
  readonly badgeClass: string
  /** The header button: its label, whether it submits, and the sentence that says why not. */
  readonly buttonLabel: string
  readonly canSubmit: boolean
  /** The sentence the button is described by: why it cannot send now (the connection), else where the document is. */
  readonly reason: string | undefined
  /** Where the document is, when `reason` had to say why it cannot be sent. */
  readonly detail: string | undefined
  readonly errors: ReadonlyArray<string>
  /** ANAF's own words on a rejection or refusal; on `unknown`, the reason the application recorded. */
  readonly errorsTitle: string
  readonly current: EFacturaSubmission | null
  /** ANAF's ZIP of the current submission is stored and can be downloaded. */
  readonly responseStored: boolean
  readonly reconcile: boolean
}

const CONNECTION_REASONS: Readonly<Record<ConnectionRead, string | undefined>> = {
  connected: undefined,
  loading: "Starea conexiunii ANAF nu este cunoscută încă.",
  unreadable: "Starea conexiunii ANAF nu a putut fi citită, așa că documentul nu poate fi trimis acum.",
  not_configured: "e-Factura nu este configurată pe server. Vezi Setări → Integrări.",
  disconnected: "Aplicația nu este conectată la ANAF. Conectează-te cu certificatul din Setări → Integrări.",
  needs_reconnect: "Conexiunea cu ANAF trebuie refăcută cu certificatul, din Setări → Integrări.",
}

const noun = (kind: SubmittedKind): string => kind === "invoice" ? "factura" : "factura storno"

const explain = (status: EFacturaStatus, kind: SubmittedKind, current: EFacturaSubmission | null): string | undefined => {
  switch (status) {
    case "not_sent": return undefined
    case "queued":
    case "processing": return (current === null ? undefined : waitReason(current))
      ?? "ANAF verifică documentul. Starea se actualizează singură."
    case "accepted": return `ANAF a înregistrat ${noun(kind)} cu indexul de încărcare ${current?.uploadIndex ?? "—"}.`
    case "rejected": return `ANAF a respins ${noun(kind)}. Erorile sunt mai jos; o poți retrimite.`
    case "refused": return `ANAF a refuzat ${noun(kind)} fără să o înregistreze. Erorile sunt mai jos; o poți retrimite.`
    case "unknown": return `Nu știm dacă ${noun(kind)} a ajuns la ANAF: încărcarea s-a întrerupt fără un răspuns clar. Caut-o la ANAF mai jos înainte s-o retrimiți.`
  }
}

const BUTTON_LABELS: Readonly<Record<EFacturaStatus, string>> = {
  not_sent: "Trimite în e-Factura",
  queued: "Se procesează la ANAF",
  processing: "Se procesează la ANAF",
  accepted: "Înregistrată în e-Factura",
  rejected: "Retrimite în e-Factura",
  refused: "Retrimite în e-Factura",
  unknown: "Stare necunoscută la ANAF",
}

export const panelView = (
  kind: SubmittedKind, history: EFacturaHistory, connection: ConnectionRead,
): EFacturaPanelView => {
  const { current } = history
  const status = documentStatus(current)
  const sendable = status === "not_sent" || status === "rejected" || status === "refused"
  const connectionReason = CONNECTION_REASONS[connection]
  const live = status === "queued" || status === "processing"
  const blocked = sendable ? connectionReason : undefined
  const explanation = explain(status, kind, current)
  return {
    status,
    badgeLabel: eFacturaStatusLabel(status),
    badgeClass: badgeClass(eFacturaStatusTone(status)),
    buttonLabel: BUTTON_LABELS[status],
    canSubmit: sendable && connectionReason === undefined,
    reason: blocked ?? explanation,
    detail: blocked === undefined ? undefined : explanation,
    errors: current === null || live ? [] : current.errors,
    errorsTitle: status === "unknown" ? "Motiv" : "Erorile ANAF",
    current,
    responseStored: current?.archiveState === "stored",
    reconcile: status === "unknown",
  }
}
