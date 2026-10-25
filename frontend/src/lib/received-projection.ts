import { formatAmount } from "./money.ts"
import { warningLabels } from "./received-warnings.ts"
import type { ReceivedKind, ReceivedSummary, UnreadableReason } from "./received-models.ts"

/**
 * The received invoices as the list renders them: every cell already a string.
 * A read invoice shows its columns and its warnings; an unreadable one, why it
 * could not be read (its archive still downloads from the detail).
 */
export interface ReceivedRow {
  readonly key: string
  readonly href: string
  /** The link's text: the number, or the SPV message for an unreadable one. */
  readonly label: string
  /** The link's accessible name, unique in the list: two suppliers may use the same number. */
  readonly linkName: string
  readonly kindLabel: string | null
  readonly supplierName: string
  readonly supplierCif: string
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly vat: string
  readonly currency: string
  readonly readable: boolean
  readonly readLabel: string
  readonly notes: ReadonlyArray<string>
}

export const receivedDetailHref = (messageId: string): string => `/received/${encodeURIComponent(messageId)}`

export const receivedKindLabel = (kind: ReceivedKind): string => kind === "credit_note" ? "Notă de credit" : "Factură"

const FIELD_FAILURES = {
  missing: "lipsește câmpul",
  duplicate: "apare de mai multe ori câmpul",
  invalid: "are o valoare invalidă câmpul",
  unbound_prefix: "are un prefix XML nedeclarat câmpul",
} as const

/** Why an archive could not be read, in a sentence; the refusal codes and field paths stay as the server wrote them. */
export const unreadableText = (reason: UnreadableReason): string => {
  if (reason.source === "zip") return `Arhiva ZIP nu a putut fi deschisă (${reason.refusal}).`
  if (reason.source === "encoding") return "XML-ul facturii nu este text UTF-8 valid."
  const { failure } = reason
  if (failure.reason === "xml") return `XML-ul facturii nu a putut fi citit (${failure.refusal}).`
  if (failure.reason === "not_ubl") return "Documentul din arhivă nu este o factură sau o notă de credit UBL."
  return `În XML ${FIELD_FAILURES[failure.reason]} ${failure.field}.`
}

/** ANAF's `data_creare` (`YYYYMMDDHHmm`, Romanian time) as `22.10.2026 10:00`; anything else as it came. */
export const spvDate = (value: string): string => {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(value)
  if (match === null) return value
  const [, year, month, day, hour, minute] = match
  return `${day ?? ""}.${month ?? ""}.${year ?? ""} ${hour ?? ""}:${minute ?? ""}`
}

const DASH = "—"

export const projectReceivedRow = (summary: ReceivedSummary): ReceivedRow => {
  const common = { key: summary.messageId, href: receivedDetailHref(summary.messageId) }
  if (!summary.readable) {
    return {
      ...common, label: `Mesaj SPV ${summary.messageId}`, linkName: `Mesaj SPV ${summary.messageId}, necitit`, kindLabel: null,
      supplierName: DASH, supplierCif: DASH, issueDate: DASH, dueDate: DASH, total: DASH, vat: DASH, currency: DASH,
      readable: false, readLabel: "Necitită", notes: [unreadableText(summary.reason)],
    }
  }
  const { listing } = summary
  const kind = receivedKindLabel(listing.kind)
  return {
    ...common, label: listing.number, linkName: `${kind} ${listing.number} de la ${listing.supplierName}`,
    kindLabel: listing.kind === "credit_note" ? kind : null,
    supplierName: listing.supplierName, supplierCif: listing.supplierCif, issueDate: listing.issueDate,
    dueDate: summary.dueDate ?? DASH, total: formatAmount(listing.payable), vat: formatAmount(listing.taxTotal),
    currency: listing.currency, readable: true, readLabel: "Citită", notes: warningLabels(summary.warnings),
  }
}
