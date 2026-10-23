import type { AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import { advancesCoverage, retriable, type FetchRecord, type FetchWindow, type Interpretation } from "../../cubes/invoicing/efactura/received/index.ts"
import type { ListedMessage } from "../../cubes/invoicing/efactura/submissions/index.ts"
import { budgetStore } from "./postgres-efactura-budgets.ts"
import { saveInterpretation, storeArchive, type MessageKey } from "./postgres-efactura-received-archive.ts"
import { messageStore } from "./postgres-efactura-received-messages.ts"
import { ACTIVE_FETCH, FETCH_COLUMNS, fetchFrom, gapValues } from "./postgres-efactura-received-rows.ts"
import { firstRow, integer, text } from "./postgres-rows.ts"
import type { QueryValue } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

export type { NextMessage } from "./postgres-efactura-received-messages.ts"

export interface DueFetch {
  readonly fetch: FetchRecord
  /** List calls in a row that ANAF answered unclearly, or not at all. */
  readonly retries: number
  /** The organization's coverage now, for the window of a fetch whose first page is still to be listed. */
  readonly coveredUntil: string | undefined
}

const DUE = `SELECT ${FETCH_COLUMNS},(SELECT c.covered_until FROM efactura_received_coverage c WHERE c.organization_id=f.organization_id
  AND c.environment=f.environment) AS covered_until FROM efactura_received_fetches f WHERE environment=$1 AND ${ACTIVE_FETCH} AND next_attempt_at<=$2
  ORDER BY next_attempt_at,id LIMIT 1`

const COVER = `INSERT INTO efactura_received_coverage(organization_id,environment,covered_until,fetch_id,updated_at) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(organization_id,environment) DO UPDATE SET covered_until=EXCLUDED.covered_until,fetch_id=EXCLUDED.fetch_id,
  updated_at=EXCLUDED.updated_at WHERE efactura_received_coverage.covered_until<EXCLUDED.covered_until`

/**
 * The dispatcher's reads and writes of received-invoice fetches, inside one
 * of its fenced transactions, all at the instant `at`. The dispatcher is the
 * only writer of an active fetch; each write is conditioned on the state it
 * read and fails the transaction otherwise.
 */
export const receivedStore = (client: TransactionClient, at: Date) => {
  const now = at.toISOString()
  const messages = messageStore(client, at)

  const update = async (fetch: FetchRecord, changes: Readonly<Record<string, QueryValue>>): Promise<void> => {
    const entries = Object.entries({ ...changes, updated_at: now })
    const sets = entries.map(([column], index) => `${column}=$${String(index + 3)}`).join(",")
    const { rowCount } = await client.query(`UPDATE efactura_received_fetches SET ${sets} WHERE id=$1 AND state=$2`,
      [fetch.id, fetch.state, ...entries.map(([, value]) => value)])
    if (rowCount !== 1) throw new Error("the fetch is not where the dispatcher left it")
  }

  return {
    ...budgetStore(client, at),
    next: messages.next,
    due: async (environment: AnafEnvironment): Promise<DueFetch | undefined> => {
      const row = firstRow((await client.query(DUE, [environment, now])).rows)
      if (row === undefined) return undefined
      const coveredUntil = row.covered_until === null ? undefined : text(row, "covered_until")
      return { fetch: fetchFrom(row), retries: integer(row, "retries"), coveredUntil }
    },
    wait: (fetch: FetchRecord, until: string) => update(fetch, { next_attempt_at: until }),
    fail: (fetch: FetchRecord, errors: ReadonlyArray<string>) => update(fetch, { state: "failed", errors: JSON.stringify(errors) }),
    retryList: (fetch: FetchRecord, retries: number, until: string) => update(fetch, { retries, next_attempt_at: until }),
    /**
     * One page listed in `window` (the fetch's own, or the one its first page
     * was asked for): its received invoices recorded, the counters moved; past
     * the last page, downloading starts. An empty window is ANAF's `0` pages,
     * counted as the one page asked for.
     */
    listed: async (fetch: FetchRecord, window: FetchWindow, page: number, pages: number, listed: ReadonlyArray<ListedMessage>) => {
      const queued = await messages.adopt(fetch, listed)
      const [gapStart, gapEnd] = gapValues(window)
      await update(fetch, { state: page >= pages ? "downloading" : "listing", pages_listed: page, pages_total: Math.max(pages, page), retries: 0,
        found: fetch.found + listed.length, queued: fetch.queued + queued, next_attempt_at: now,
        window_start: window.start, window_end: window.end, gap_start: gapStart, gap_end: gapEnd })
    },
    /** The message stored with its archive and what was read out of it, in one write. */
    stored: async (fetch: FetchRecord, message: MessageKey, archive: Uint8Array, interpretation: Interpretation) => {
      await messages.stored(fetch, message)
      await storeArchive(client, message, archive, now)
      await saveInterpretation(client, message, interpretation, now)
      await update(fetch, { downloaded: fetch.downloaded + 1, next_attempt_at: now })
    },
    /** One more failed download; past the last attempt the fetch gives the message up. */
    downloadFailed: async (fetch: FetchRecord, message: MessageKey, errors: ReadonlyArray<string>) => {
      const attempts = await messages.failed(fetch, message, errors)
      await update(fetch, { failed: fetch.failed + (retriable(attempts) ? 0 : 1), next_attempt_at: now })
    },
    /** Nothing left to try: `completed`, and the coverage moves to the window's end unless a message was given up. */
    complete: async (fetch: FetchRecord) => {
      const givenUp = await messages.givenUp(fetch)
      await update(fetch, { state: "completed" })
      if (advancesCoverage(givenUp)) await client.query(COVER, [fetch.organizationId, fetch.environment, fetch.window.end, fetch.id, now])
    },
  }
}

export type ReceivedStore = ReturnType<typeof receivedStore>
