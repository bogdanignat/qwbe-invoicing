import {
  BLOCKED_CONFLICT, BLOCKED_CORRUPT, BLOCKED_MARKER, BLOCKED_UNAVAILABLE,
} from "./operation-recovery-journal.ts"
import { CONFLICT_DELETED, CONFLICT_REUSED } from "./operation-recovery-port.ts"
import type { JournalEntry, RecoveryOperation, RecoveryRecord } from "./operation-recovery-types.ts"

/**
 * What the screen shows about an unresolved write, as data.
 *
 * The card exists to make one thing recognisable: *which* document is in
 * doubt — the buyer, the series, the date, how many lines — so the user can
 * look it up in the registry before deciding. It never sends anything on its
 * own: the only requests that follow are the ones the user asks for.
 */
export const REPLAY_LABEL = "Retrimite salvarea/emiterea (același document, aceeași cheie)"
export const DISMISS_LABEL = "Am verificat registrul — închide avertismentul"

export interface RecoveryDetail {
  readonly label: string
  readonly value: string
}

/** Where the document this notice is about can be opened, when it is already known. */
export interface RecoveryLink {
  readonly href: string
  readonly label: string
}

export interface RecoveryNoticeModel {
  readonly title: string
  readonly message: string
  readonly details: ReadonlyArray<RecoveryDetail>
  /** The known document, when the write is confirmed; otherwise the registry link the card always shows. */
  readonly link?: RecoveryLink
  /** Present only when a replay is still the right move: the same request, under the same key. */
  readonly replay: RecoveryRecord | undefined
  readonly dismissible: boolean
}

/**
 * A title per operation, as a total record: adding an operation without a title
 * is a compile error here, not a blank card in front of the user.
 */
const OPERATION_TITLE: Readonly<Record<RecoveryOperation, string>> = {
  "create-draft": "Salvarea draftului nu este confirmată",
  "issue-invoice": "Emiterea facturii nu este confirmată",
  "create-proforma": "Emiterea proformei nu este confirmată",
  "convert-proforma-invoice": "Emiterea facturii din proformă nu este confirmată",
  "convert-proforma-draft": "Crearea draftului din proformă nu este confirmată",
}

const PENDING = "Cererea a plecat, dar răspunsul nu a ajuns. Documentul poate exista deja pe server. Retrimiterea folosește exact aceeași cerere și aceeași cheie, deci nu poate crea un al doilea document."

const CONFLICT_DETAIL: Readonly<Record<string, string>> = {
  [CONFLICT_REUSED]: "Aceeași cheie fusese folosită pentru un alt document.",
  [CONFLICT_DELETED]: "Documentul creat sub această cheie a fost între timp șters.",
}

const details = (record: RecoveryRecord): ReadonlyArray<RecoveryDetail> => [
  { label: "Cumpărător", value: record.summary.buyerName },
  { label: "Serie", value: record.summary.series },
  { label: "Data emiterii", value: record.summary.issueDate },
  { label: "Linii", value: String(record.summary.lineCount) },
]

const fromRecord = (record: RecoveryRecord): RecoveryNoticeModel => record.state === "conflict"
  ? {
    title: OPERATION_TITLE[record.operation],
    message: `${BLOCKED_CONFLICT} ${record.conflict === undefined ? "" : CONFLICT_DETAIL[record.conflict] ?? ""}`.trim(),
    details: details(record),
    replay: undefined,
    dismissible: true,
  }
  : {
    title: OPERATION_TITLE[record.operation],
    message: PENDING,
    details: details(record),
    replay: record,
    dismissible: false,
  }

export const recoveryNotice = (entry: JournalEntry): RecoveryNoticeModel | undefined => {
  if (entry.kind === "empty") return undefined
  if (entry.kind === "record") return fromRecord(entry.record)
  if (entry.kind === "marker") {
    return {
      title: OPERATION_TITLE[entry.marker.operation],
      message: BLOCKED_MARKER,
      details: [],
      replay: undefined,
      dismissible: true,
    }
  }
  return {
    title: "Registrul local de recuperare nu poate fi folosit",
    message: entry.kind === "corrupt" ? BLOCKED_CORRUPT : BLOCKED_UNAVAILABLE,
    details: [],
    replay: undefined,
    dismissible: entry.kind === "corrupt",
  }
}

/**
 * A write the server confirmed, whose follow-up on the screen did not run.
 *
 * The journal is already clean here — the document exists and is named — so
 * nothing may be replayed. What must not happen is the opposite mistake: an
 * error message on a screen that still holds the same form, inviting a normal
 * save or issue that would author a *second* document under a fresh key. The
 * notice therefore states the known result, links to it, and the screen keeps
 * writing blocked until the user follows the link or starts a new document.
 */
export interface KnownWrite {
  readonly kind: "draft" | "invoice" | "proforma"
  readonly id: string
  readonly effectsError: unknown
}

const KNOWN_TITLE: Readonly<Record<KnownWrite["kind"], string>> = {
  draft: "Draftul a fost salvat, dar ecranul nu a putut fi actualizat",
  invoice: "Factura a fost emisă, dar ecranul nu a putut fi actualizat",
  proforma: "Proforma a fost emisă, dar ecranul nu a putut fi actualizat",
}

const KNOWN_MESSAGE = "Documentul există pe server sub cheia folosită. Nu salva și nu emite din nou de pe acest ecran — ai crea un al doilea document. Deschide documentul de mai jos sau începe unul nou."

const KNOWN_LINK: Readonly<Record<KnownWrite["kind"], (id: string) => RecoveryLink>> = {
  draft: (id) => ({ href: `/drafts/${encodeURIComponent(id)}`, label: "Deschide draftul salvat" }),
  invoice: (id) => ({ href: `/invoices/${encodeURIComponent(id)}`, label: "Deschide factura emisă" }),
  proforma: (id) => ({ href: `/proformas/${encodeURIComponent(id)}`, label: "Deschide proforma emisă" }),
}

export const knownResultNotice = (result: KnownWrite | undefined): RecoveryNoticeModel | undefined => {
  if (result === undefined || result.effectsError === undefined || result.effectsError === null) return undefined
  return {
    title: KNOWN_TITLE[result.kind],
    message: KNOWN_MESSAGE,
    details: [],
    link: KNOWN_LINK[result.kind](result.id),
    replay: undefined,
    dismissible: true,
  }
}
