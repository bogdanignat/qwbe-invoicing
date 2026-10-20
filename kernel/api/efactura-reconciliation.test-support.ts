import assert from "node:assert/strict"

import { dispatchRig, type DispatchRig } from "../efactura/dispatch/dispatch.test-support.ts"
import type { Reply } from "../http/plugins-http.test-support.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"

/** The reconciliation routes through the real server, on a real database, with the fake ANAF behind every call. */
export const withRig = (label: string, use: (rig: DispatchRig) => Promise<void>, grants?: Parameters<typeof dispatchRig>[1]) =>
  withMigrated(label, async (fixture) => {
    const rig = await dispatchRig(fixture, grants)
    try { await use(rig) } finally { await rig.close() }
  })

export const conflict = (reply: Reply, code: string) => {
  assert.deepEqual([reply.status, reply.body], [409, { error: "DomainConflict", code }], code)
}

/** A queued submission turned `unknown` by hand: nothing at ANAF lists it. */
export const unknownSubmission = async (rig: DispatchRig, key: string) => {
  const invoiceId = await rig.invoice(key)
  const id = await rig.submitted(invoiceId)
  await rig.sql("UPDATE efactura_submissions SET state='unknown' WHERE id=$1", [id])
  return { invoiceId, id }
}

export const candidates = (rig: DispatchRig, id: string, page?: number) =>
  rig.server.call("GET", `/api/efactura/submissions/${id}/candidates${page === undefined ? "" : `?page=${String(page)}`}`)
export const link = (rig: DispatchRig, id: string, body: unknown) => rig.server.call("POST", `/api/efactura/submissions/${id}/link`, body)
export const resubmit = (rig: DispatchRig, id: string, body: unknown = { confirmed: true }) =>
  rig.server.call("POST", `/api/efactura/submissions/${id}/resubmit`, body)

/** The query of every list call ANAF received. */
export const listCalls = (rig: DispatchRig): ReadonlyArray<Readonly<Record<string, string | undefined>>> => rig.fake.calls
  .filter((call) => call.operation === "lista")
  .map((call) => ({ ...Object.fromEntries(new URL(call.path, "https://api.anaf.ro").searchParams), authorization: call.authorization }))

export const count = async (rig: DispatchRig, sql: string, values: ReadonlyArray<unknown> = []) =>
  Number((await rig.sql(`SELECT count(*)::int AS n FROM ${sql}`, values))[0]?.n)
