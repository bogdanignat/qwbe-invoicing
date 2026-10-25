import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import { Effect } from "effect"

import { efacturaPermissions } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { createReceivedService, type FetchRecord, type ReceivedFailure } from "../../../cubes/invoicing/efactura/received/index.ts"
import { ORG } from "../anaf/connection.test-support.ts"
import { readReceivedZip } from "../anaf/zip-reader.ts"
import { buildZip } from "../anaf/zip.test-support.ts"
import { createPostgresReceivedStore } from "../../storage/postgres-efactura-received.ts"
import type { TestFixture } from "../../storage/postgres-rig.test-support.ts"
import { dispatchRig } from "./dispatch.test-support.ts"

/** ANAF TEST's own ZIP of a received invoice (T-2024), anonymised: supplier and buyer CIF 19999927, number `TEST 19`. */
export const FIXTURE_ZIP = readFileSync(new URL("../../../cubes/invoicing/efactura/fixtures/anaf-test-received-invoice.zip", import.meta.url))

const opened = readReceivedZip(FIXTURE_ZIP)
assert.ok(opened.ok, "the fixture opens")
const FIXTURE_XML = new TextDecoder().decode(opened.invoice)

/** ANAF's layout (signature first, then the invoice) around the fixture's invoice renumbered: one distinct, readable invoice per message. */
export const receivedZip = (number: string, edit = (xml: string) => xml): Buffer => buildZip([
  { name: "semnatura_1.xml", content: "<Signature/>" },
  { name: "1.xml", content: edit(FIXTURE_XML.replace("<cbc:ID>TEST 19</cbc:ID>", `<cbc:ID>${number}</cbc:ID>`)) },
])

/** Starts like a ZIP, so ANAF's answer is an archive, and is nothing more. */
export const BROKEN_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not a zip at all")])

export const RECEIVE = efacturaPermissions("efactura").receive

export type FetchRow = Readonly<Record<string, unknown>>

/**
 * The dispatcher rig plus the service a user's click goes through, and the
 * received tables as the dispatcher leaves them.
 */
export const receivedRig = async (fixture: TestFixture, grants?: Parameters<typeof dispatchRig>[1]) => {
  const rig = await dispatchRig(fixture, grants)
  const service = (options: { readonly configured?: boolean; readonly permissions?: ReadonlyArray<string> } = {}) => createReceivedService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "admin", roles: ["admin"], permissions: options.permissions ?? [RECEIVE] },
      organization: { id: ORG } }) },
    permissions: efacturaPermissions("efactura"), clock: { now: Effect.sync(rig.now) }, ids: { next: Effect.sync(randomUUID) },
    store: createPostgresReceivedStore(fixture.pool, "test"), configured: options.configured ?? true, environment: "test",
  })
  const request = () => Effect.runPromise(service().requestFetch())
  const refusal = async (options?: Parameters<typeof service>[0]): Promise<ReceivedFailure> =>
    Effect.runPromise(Effect.flip(service(options).requestFetch()))
  const fetchRow = async (id: string): Promise<FetchRow> => {
    const [row] = await rig.sql(`SELECT state,pages_listed,pages_total,found,queued,downloaded,failed,retries,errors,window_start,window_end,gap_start,gap_end
      FROM efactura_received_fetches WHERE id=$1`, [id])
    assert.ok(row !== undefined, `fetch ${id}`)
    return row
  }
  const ends = async (fetch: FetchRecord, state: "completed" | "failed" = "completed"): Promise<FetchRow> => {
    await rig.until(`fetch ${state}`, async () => (await fetchRow(fetch.id)).state === state)
    return fetchRow(fetch.id)
  }
  const coveredUntil = async (): Promise<string | undefined> =>
    (await rig.sql("SELECT covered_until FROM efactura_received_coverage WHERE organization_id=$1", [ORG]))[0]?.covered_until as string | undefined
  const messages = () => rig.sql(`SELECT anaf_message_id,state,attempts,fetch_id FROM efactura_received_messages ORDER BY anaf_message_id`)
  const invoices = () => rig.sql(`SELECT anaf_message_id,document_kind,number,supplier_name,supplier_cif,total_excluding_tax,tax_total,payable,
    content->>'number' AS content_number,jsonb_typeof(content->'dueDate') AS due,warnings FROM efactura_received_invoices ORDER BY anaf_message_id`)
  const archives = () => rig.sql("SELECT anaf_message_id,archive,size FROM efactura_received_archives ORDER BY anaf_message_id")
  const listCalls = () => rig.fake.calls.filter((call) => call.operation === "lista")
  return { ...rig, service, request, refusal, fetchRow, ends, coveredUntil, messages, invoices, archives, listCalls }
}

export type ReceivedRig = Awaited<ReturnType<typeof receivedRig>>
