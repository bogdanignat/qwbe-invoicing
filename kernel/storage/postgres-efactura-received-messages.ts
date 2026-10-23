import { DOWNLOAD_RETRY_MS, MAX_DOWNLOAD_ATTEMPTS, type FetchRecord } from "../../cubes/invoicing/efactura/received/index.ts"
import type { ListedMessage } from "../../cubes/invoicing/efactura/submissions/index.ts"
import type { MessageKey } from "./postgres-efactura-received-archive.ts"
import { firstRow, integer, text } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/** The next message a downloading fetch tries, the instant its next retry is due, or nothing left to try. */
export type NextMessage = { readonly due: MessageKey } | { readonly retryAt: string } | { readonly done: true }

/**
 * A listed message is new, or known and never stored (a fetch that failed or
 * gave it up): this fetch takes it over and tries it from the first attempt.
 * One already stored, or already this fetch's, is left as it is.
 */
const ADOPT = `INSERT INTO efactura_received_messages(organization_id,environment,anaf_message_id,upload_index,cif,details,anaf_created,
  fetch_id,state,next_attempt_at,listed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'listed',$9,$9,$9)
  ON CONFLICT(organization_id,environment,anaf_message_id) DO UPDATE SET fetch_id=EXCLUDED.fetch_id,state='listed',attempts=0,errors='[]',
  next_attempt_at=EXCLUDED.next_attempt_at,updated_at=EXCLUDED.updated_at
  WHERE efactura_received_messages.state<>'stored' AND efactura_received_messages.fetch_id<>EXCLUDED.fetch_id`

const OWN = "organization_id=$1 AND environment=$2 AND fetch_id=$3"
/** One message of the fetch that is still to be stored. */
const PENDING = `${OWN} AND anaf_message_id=$4 AND state IN('listed','download_failed')`

const own = (fetch: FetchRecord) => [fetch.organizationId, fetch.environment, fetch.id] as const

const moved = (): never => { throw new Error("the message is not where the dispatcher left it") }

/** The received messages as the dispatcher moves them, at the instant `at`, inside its transaction. */
export const messageStore = (client: TransactionClient, at: Date) => {
  const now = at.toISOString()
  return {
    /** How many of the page's messages this fetch now downloads. */
    adopt: async (fetch: FetchRecord, messages: ReadonlyArray<ListedMessage>): Promise<number> => {
      let queued = 0
      for (const message of messages) {
        const { rowCount } = await client.query(ADOPT, [fetch.organizationId, fetch.environment, message.id, message.uploadIndex, message.cif,
          message.details, message.createdAt, fetch.id, now])
        queued += rowCount
      }
      return queued
    },
    next: async (fetch: FetchRecord): Promise<NextMessage> => {
      const row = firstRow((await client.query(`SELECT anaf_message_id,next_attempt_at FROM efactura_received_messages WHERE ${OWN}
        AND (state='listed' OR (state='download_failed' AND attempts<$4)) ORDER BY next_attempt_at,anaf_message_id LIMIT 1`,
      [...own(fetch), MAX_DOWNLOAD_ATTEMPTS])).rows)
      if (row === undefined) return { done: true }
      const retryAt = text(row, "next_attempt_at")
      if (retryAt > now) return { retryAt }
      return { due: { organizationId: fetch.organizationId, environment: fetch.environment, messageId: text(row, "anaf_message_id") } }
    },
    stored: async (fetch: FetchRecord, message: MessageKey): Promise<void> => {
      const { rowCount } = await client.query(`UPDATE efactura_received_messages SET state='stored',errors='[]',updated_at=$5 WHERE ${PENDING}`,
        [...own(fetch), message.messageId, now])
      if (rowCount !== 1) moved()
    },
    /** One more failed attempt, tried again a while later; answers how many there were. */
    failed: async (fetch: FetchRecord, message: MessageKey, errors: ReadonlyArray<string>): Promise<number> => {
      const row = firstRow((await client.query(`UPDATE efactura_received_messages SET state='download_failed',attempts=attempts+1,
        errors=$5::jsonb,next_attempt_at=$6,updated_at=$7 WHERE ${PENDING} RETURNING attempts`,
      [...own(fetch), message.messageId, JSON.stringify(errors), new Date(at.getTime() + DOWNLOAD_RETRY_MS).toISOString(), now])).rows)
      return row === undefined ? moved() : integer(row, "attempts")
    },
    /** Called once nothing is left to try: every failed message of the fetch is one it gave up. */
    givenUp: async (fetch: FetchRecord): Promise<number> => {
      const row = firstRow((await client.query(`SELECT count(*)::int AS given_up FROM efactura_received_messages WHERE ${OWN}
        AND state='download_failed'`, own(fetch))).rows)
      return row === undefined ? 0 : integer(row, "given_up")
    },
  }
}
