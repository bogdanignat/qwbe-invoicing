import assert from "node:assert/strict"

import { Effect, Redacted } from "effect"

import { DAY_MS, type ConnectionWrite } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { anafSettingsFor, ISSUER_CIF, ORG } from "../anaf/connection.test-support.ts"
import { connectionHost } from "../anaf/connection-host.ts"
import { startFakeAnaf, type FakeAnaf } from "../anaf/fake-anaf.test-support.ts"
import type { Transport } from "../../outbound/send.ts"
import { allPlugins } from "../../plugins.ts"
import {
  dueDate, issueDate, issueInvoice, lines, ok, seed, serve, type Reply, type ServeOptions,
} from "../../http/plugins-http.test-support.ts"
import type { TestFixture } from "../../storage/postgres-rig.test-support.ts"
import { startDispatcher, type Dispatcher } from "./dispatcher.ts"

export interface ConnectionOverrides {
  readonly cif?: string
  readonly access?: string
  readonly accessExpiresInDays?: number
  readonly generation?: number
}

/** The row a completed callback leaves: connected, the CIF verified, a token pair the fake ANAF accepts. */
export const connectionWrite = (at: Date, overrides: ConnectionOverrides = {}): ConnectionWrite => ({
  status: "connected", generation: overrides.generation ?? 1, revision: 0,
  identity: { verifiedCif: overrides.cif ?? ISSUER_CIF, connectedBy: "user-1", connectedAt: at.toISOString(),
    refreshExpiresAt: new Date(at.getTime() + 300 * DAY_MS).toISOString() },
  tokens: { access: Redacted.make(overrides.access ?? "access-0"), refresh: Redacted.make("refresh-0"),
    accessExpiresAt: new Date(at.getTime() + (overrides.accessExpiresInDays ?? 80) * DAY_MS).toISOString() },
  updatedBy: "user-1", updatedAt: at.toISOString(),
})

/** A synthetic CNP with a valid control digit: never a real person's. */
export const SYNTHETIC_CNP = "1800101221144"

/** A private buyer (B2C), without a CNP unless one is given. */
export const privateBuyer = (fiscalIdentifier = "") => ({ name: "Ion Popescu", partyType: "individual", fiscalIdentifier,
  vatRegistered: false, address: { countryCode: "RO", city: "Iași", street: "Strada 3", county: "RO-IS" } })

/** The dispatcher's lock in THIS database: `pg_locks` lists every database of the cluster, and other tests run alongside. */
export const DISPATCHER_LOCK = "pg_locks WHERE locktype='advisory' AND classid=1480 AND objid=8 AND granted"
  + " AND database=(SELECT oid FROM pg_database WHERE datname=current_database())"

/** A transport whose calls give up after `ms`: a short stand-in for ANAF's 30 s, so "sent, never answered" is quick. */
export const cutAfter = (transport: Transport, ms: number): Transport => async (url, init) => {
  const controller = new AbortController()
  init.signal?.addEventListener("abort", () => { controller.abort() }, { once: true })
  const timer = setTimeout(() => { controller.abort() }, ms)
  try { return await transport(url, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
}

export interface SubmissionRow {
  readonly state: string
  readonly archive_state: string
  readonly upload_index: string | null
  readonly download_id: string | null
  readonly errors: string
  readonly next_attempt_at: string
}

/**
 * The real server (session, CSRF, plugins) on a real database, the fake ANAF
 * behind every call, a stored ANAF connection, and dispatchers started on
 * demand with a clock the test moves forward.
 */
export const dispatchRig = async (fixture: TestFixture, grants?: ServeOptions["grants"]) => {
  const fake: FakeAnaf = await startFakeAnaf()
  const settings = anafSettingsFor()
  const clock = { offsetMs: 0 }
  const now = () => new Date(Date.now() + clock.offsetMs)
  const server = await serve(fixture, allPlugins, { settings, transport: fake.transport, ...(grants === undefined ? {} : { grants }) })
  const dispatchers: Array<Dispatcher> = []
  try {
    await seed(server)
  } catch (error) {
    await server.close()
    await fake.close()
    throw error
  }
  const host = connectionHost(fixture.pool, settings, fake.transport, now)

  /** Writes the connection as a completed callback would: connected, the CIF verified, a token pair. */
  const connect = (overrides: ConnectionOverrides = {}) =>
    Effect.runPromise(host.store.transaction((transaction) => transaction.saveConnection(ORG, connectionWrite(now(), overrides))))

  const invoice = async (key: string, body?: Record<string, unknown>): Promise<string> =>
    String((body === undefined ? await issueInvoice(server.call, key) : await ok(server.call("POST", "/api/invoices", body, key), "issue"))
      .id)
  const invoiceTo = (key: string, customer: Record<string, unknown>): Promise<string> =>
    invoice(key, { customer, series: "QWBE", issueDate, dueDate, currency: "RON", lines })
  const storno = async (invoiceId: string, key: string): Promise<string> =>
    String((await ok(server.call("POST", `/api/invoices/${invoiceId}/corrections`, { reason: "Anulare" }, key), "storno")).id)
  const submit = (id: string, kind: "invoices" | "corrections" = "invoices"): Promise<Reply> =>
    server.call("POST", `/api/${kind}/${id}/efactura/submission`, {})
  const submitted = async (id: string, kind: "invoices" | "corrections" = "invoices"): Promise<string> => {
    const reply = await submit(id, kind)
    assert.equal(reply.status, 202, JSON.stringify(reply.body))
    return String((reply.body as Record<string, unknown>).id)
  }

  const dispatcher = (transport: Transport = fake.transport, barrierHeld: () => boolean = () => true): Dispatcher => {
    const started = startDispatcher({ settings: fixture.settings, anaf: settings, transport, barrierHeld, now,
      idleMs: 25, retryMs: 50, keepaliveMs: 50 })
    dispatchers.push(started)
    return started
  }

  const row = async (id: string): Promise<SubmissionRow> => {
    const { rows } = await fixture.pool.query<SubmissionRow>(
      "SELECT state, archive_state, upload_index, download_id, errors, next_attempt_at FROM efactura_submissions WHERE id=$1", [id])
    assert.ok(rows[0] !== undefined, `submission ${id}`)
    return rows[0]
  }
  /** Polls until `check` holds, or fails with what was last seen. */
  const until = async (what: string, check: () => Promise<boolean>, ms = 15_000): Promise<void> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => { setTimeout(resolve, 25) })
    }
    assert.fail(`timed out waiting for ${what}`)
  }
  const reaches = (id: string, state: string, archive?: string) => until(`${id} ${state}`, async () => {
    const current = await row(id)
    return current.state === state && (archive === undefined || current.archive_state === archive)
  })
  const sql = async (text: string, values: ReadonlyArray<unknown> = []): Promise<ReadonlyArray<Record<string, unknown>>> =>
    (await fixture.pool.query<Record<string, unknown>>(text, [...values])).rows
  const calls = (operation: string): number => fake.calls.filter((call) => call.operation === operation).length
  const audit = async (id: string): Promise<ReadonlyArray<string>> => (await fixture.pool.query<{ readonly action: string }>(
    "SELECT action FROM audit_events WHERE target_id=$1 ORDER BY occurred_at, action", [id])).rows.map(({ action }) => action)
  const attempts = async (id: string): Promise<ReadonlyArray<string>> => (await fixture.pool.query<{ readonly line: string }>(
    "SELECT operation||':'||outcome AS line FROM efactura_submission_attempts WHERE submission_id=$1 ORDER BY started_at, id", [id]))
    .rows.map(({ line }) => line)
  const status = async (table: "issued_invoices" | "correction_documents", id: string): Promise<string> =>
    String((await fixture.pool.query<{ readonly e_factura_status: string }>(`SELECT e_factura_status FROM ${table} WHERE id=$1`, [id]))
      .rows[0]?.e_factura_status)

  const close = async () => {
    await Promise.all(dispatchers.map((started) => started.stop()))
    await server.close()
    await fake.close()
  }
  return {
    fake, settings, clock, now, server, host, connect, invoice, invoiceTo, storno, submit, submitted, dispatcher, row, until, reaches, calls, audit,
    attempts, status, sql, close,
  }
}

export type DispatchRig = Awaited<ReturnType<typeof dispatchRig>>
