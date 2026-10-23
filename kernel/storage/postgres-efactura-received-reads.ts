import type {
  ReceivedDetail, ReceivedListing, ReceivedMessage, ReceivedReads, ReceivedSummary, UnreadableReason,
} from "../../cubes/invoicing/efactura/received/index.ts"
import type { ReceivedDocument, ReceivedKind, ReceivedWarning } from "../../cubes/invoicing/efactura/received-ubl/index.ts"
import { FETCH_COLUMNS, fetchFrom } from "./postgres-efactura-received-rows.ts"
import { oneOf } from "./postgres-efactura-submission-rows.ts"
import { read } from "./postgres-errors.ts"
import { money } from "./postgres-money.ts"
import { bytes, firstRow, integer, row as objectOf, text, type Row } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

const KINDS: ReadonlyArray<ReceivedKind> = ["invoice", "credit_note"]
const SCOPE = "a.organization_id=$1 AND a.environment=$2"

/**
 * The list's order, newest first in the SPV: `data_creare`, then the message
 * id as a number. The ids are digits only (a CHECK), so length then text is
 * numeric order, and stays a total order as the text is unique.
 * `efactura_received_messages_newest` is this key, for ORDER BY and cursor.
 */
const NEWEST = "(m.anaf_created,length(m.anaf_message_id),m.anaf_message_id)"

/** A stored archive with its message and whichever of the two readings it has: exactly one, as `saveInterpretation` leaves it. */
const RECEIVED = (columns: string) => `SELECT a.anaf_message_id,m.anaf_created,a.stored_at,i.document_kind,i.number,i.issue_date,i.currency,
  i.supplier_name,i.supplier_cif,i.total_excluding_tax,i.tax_total,i.payable,u.reason,${columns}
  FROM efactura_received_archives a
  JOIN efactura_received_messages m ON m.organization_id=a.organization_id AND m.environment=a.environment AND m.anaf_message_id=a.anaf_message_id
  LEFT JOIN efactura_received_invoices i ON i.organization_id=a.organization_id AND i.environment=a.environment AND i.anaf_message_id=a.anaf_message_id
  LEFT JOIN efactura_received_unreadable u ON u.organization_id=a.organization_id AND u.environment=a.environment AND u.anaf_message_id=a.anaf_message_id
  WHERE ${SCOPE}`

/** Our own JSON, written by `saveInterpretation`: only its outer shape is checked. */
const json = (value: Row, field: string, shape: "object" | "array"): unknown => {
  const found = value[field]
  if (shape === "array" ? !Array.isArray(found) : objectOf(found) === undefined || Array.isArray(found)) throw new Error(`invalid ${field}`)
  return found
}

const messageFrom = (value: Row): ReceivedMessage => ({
  messageId: text(value, "anaf_message_id"), spvCreatedAt: text(value, "anaf_created"), storedAt: text(value, "stored_at"),
})

const listingFrom = (value: Row): ReceivedListing => ({
  kind: oneOf(KINDS, value, "document_kind"), number: text(value, "number"), issueDate: text(value, "issue_date"),
  currency: text(value, "currency"), supplierName: text(value, "supplier_name"), supplierCif: text(value, "supplier_cif"),
  totalExcludingTax: money(value, "total_excluding_tax"), taxTotal: money(value, "tax_total"), payable: money(value, "payable"),
})

const readable = (value: Row): boolean => {
  if ((value.document_kind === null) === (value.reason === null)) throw new Error("a received archive needs exactly one reading")
  return value.document_kind !== null
}

const unreadable = (value: Row) => ({ readable: false as const, reason: json(value, "reason", "object") as UnreadableReason })

const summaryFrom = (value: Row): ReceivedSummary => ({
  ...messageFrom(value),
  ...readable(value) ? { readable: true, listing: listingFrom(value), warnings: integer(value, "warning_count") } : unreadable(value),
})

const detailFrom = (value: Row): ReceivedDetail => ({
  ...messageFrom(value),
  ...readable(value)
    ? { readable: true, listing: listingFrom(value), content: json(value, "content", "object") as ReceivedDocument,
      warnings: json(value, "warnings", "array") as ReadonlyArray<ReceivedWarning> }
    : unreadable(value),
})

/** The received invoices of one organization in one environment, as the API reads them. */
export const receivedReads = (client: TransactionClient): ReceivedReads => ({
  latestFetch: ({ organizationId, environment }) => read("find latest received-invoice fetch", async () => {
    const found = firstRow((await client.query(`SELECT ${FETCH_COLUMNS} FROM efactura_received_fetches WHERE organization_id=$1
      AND environment=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [organizationId, environment])).rows)
    return found === undefined ? undefined : fetchFrom(found)
  }),
  listReceived: ({ organizationId, environment }, page) => read("list received invoices", async () => {
    const after = page.after === undefined ? "" : `AND ${NEWEST}<($4,length($5),$5)`
    const cursor = page.after === undefined ? [] : [page.after.spvCreatedAt, page.after.messageId]
    const { rows } = await client.query(`${RECEIVED("COALESCE(jsonb_array_length(i.warnings),0)::int AS warning_count")} ${after}
      ORDER BY m.anaf_created DESC,length(m.anaf_message_id) DESC,m.anaf_message_id DESC LIMIT $3`,
    [organizationId, environment, page.limit + 1, ...cursor])
    return rows.map(summaryFrom)
  }),
  findReceived: ({ organizationId, environment }, messageId) => read("find received invoice", async () => {
    const found = firstRow((await client.query(`${RECEIVED("i.content,i.warnings")} AND a.anaf_message_id=$3`,
      [organizationId, environment, messageId])).rows)
    return found === undefined ? undefined : detailFrom(found)
  }),
  readArchive: ({ organizationId, environment }, messageId) => read("read received archive", async () => {
    const found = firstRow((await client.query(`SELECT archive FROM efactura_received_archives a WHERE ${SCOPE} AND a.anaf_message_id=$3`,
      [organizationId, environment, messageId])).rows)
    return found === undefined ? undefined : bytes(found, "archive")
  }),
})
