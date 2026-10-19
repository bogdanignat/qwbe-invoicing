import assert from "node:assert/strict"
import test from "node:test"

import { dispatchRig, type DispatchRig } from "../efactura/dispatch/dispatch.test-support.ts"
import { customer, dueDate, issueDate, lines, ok } from "../http/plugins-http.test-support.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"

/**
 * `POST /api/{invoices|corrections}/{id}/efactura/submission` and the reading
 * routes, through the real server: session cookie, CSRF, the plugin's routes,
 * a real database. No dispatcher runs here, so nothing leaves for ANAF.
 */

const withRig = (label: string, use: (rig: DispatchRig) => Promise<void>, grants?: Parameters<typeof dispatchRig>[1]) =>
  withMigrated(label, async (fixture) => {
    const rig = await dispatchRig(fixture, grants)
    try { await use(rig) } finally { await rig.close() }
  })

const conflict = (reply: { readonly status: number; readonly body: unknown }, code: string) => {
  assert.deepEqual([reply.status, reply.body], [409, { error: "DomainConflict", code }], code)
}

const privateBuyer = { name: "Ion Popescu", partyType: "individual", fiscalIdentifier: "", vatRegistered: false,
  address: { countryCode: "RO", city: "Iași", street: "Strada 3", county: "RO-IS" } }

void test("two concurrent submits of one document queue exactly one submission", () => withRig("efs_concurrent", async (rig) => {
  await rig.connect()
  const invoiceId = await rig.invoice("inv-1")
  const replies = await Promise.all([rig.submit(invoiceId), rig.submit(invoiceId)])
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 202])
  const ids = replies.map((reply) => (reply.body as Record<string, unknown>).id)
  assert.equal(ids[0], ids[1])
  const [created] = replies.filter((reply) => reply.status === 202)
  assert.deepEqual(Object.keys(created?.body as object).includes("organizationId"), false)
  assert.equal((created?.body as Record<string, unknown>).state, "queued")
  assert.equal((created?.body as Record<string, unknown>).standard, "UBL")
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_submissions"))[0]?.n, 1)
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM audit_events WHERE action='efactura_submission.queued'"))[0]?.n, 1)
  assert.equal(await rig.status("issued_invoices", invoiceId), "queued")
}))

void test("submit refuses without a connection, for another CIF, for a private buyer and for a proforma",
  () => withRig("efs_refusals", async (rig) => {
    const invoiceId = await rig.invoice("inv-1")
    conflict(await rig.submit(invoiceId), "efactura_not_connected")
    await rig.connect({ cif: "18547290" })
    conflict(await rig.submit(invoiceId), "efactura_cif_mismatch")
    await rig.connect()
    const privateInvoice = await rig.invoice("inv-b2c", { customer: privateBuyer, series: "QWBE", issueDate, dueDate, currency: "RON", lines })
    conflict(await rig.submit(privateInvoice), "efactura_b2c_refused")
    const storno = await ok(rig.server.call("POST", `/api/invoices/${privateInvoice}/corrections`, { reason: "Anulare" }, "storno-b2c"), "storno")
    conflict(await rig.submit(String(storno.id), "corrections"), "efactura_b2c_refused")
    const proforma = await ok(rig.server.call("POST", "/api/proformas",
      { customer, proformaSeries: "PRO", issueDate, dueDate, currency: "RON", lines }, "proforma-1"), "proforma")
    assert.equal((await rig.submit(String(proforma.id))).status, 404, "a proforma has no e-Factura")
    assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_submissions"))[0]?.n, 0)
    assert.equal(await rig.status("issued_invoices", invoiceId), "not_sent")
  }))

void test("submit needs the session's CSRF token", () => withRig("efs_csrf", async (rig) => {
  await rig.connect()
  const invoiceId = await rig.invoice("inv-1")
  const reply = await fetch(`${rig.server.origin}/api/invoices/${invoiceId}/efactura/submission`, {
    method: "POST", headers: { cookie: rig.server.cookie, origin: rig.server.origin, "content-type": "application/json" }, body: "{}" })
  assert.equal(reply.status, 403)
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_submissions"))[0]?.n, 0)
}))

void test("a session without efactura:submit is refused with 403 and queues nothing", () => withRig("efs_forbidden", async (rig) => {
  await rig.connect()
  const invoiceId = await rig.invoice("inv-1")
  const reply = await rig.submit(invoiceId)
  assert.deepEqual([reply.status, (reply.body as Record<string, unknown>).error], [403, "PermissionDenied"])
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_submissions"))[0]?.n, 0)
  assert.equal(await rig.status("issued_invoices", invoiceId), "not_sent")
  assert.equal((await rig.server.call("GET", `/api/invoices/${invoiceId}/efactura/submissions`)).status, 200, "reading needs only read")
}, (permissions) => permissions.filter((permission) => permission !== "efactura:submit")))

void test("after refused or rejected a new submission is queued; unknown and accepted answer the existing one",
  () => withRig("efs_again", async (rig) => {
    await rig.connect()
    const invoiceId = await rig.invoice("inv-1")
    const first = await rig.submitted(invoiceId)
    await rig.sql("UPDATE efactura_submissions SET state='refused', errors='[\"E\"]' WHERE id=$1", [first])
    const second = await rig.submitted(invoiceId)
    assert.notEqual(second, first)
    await rig.sql(`UPDATE efactura_submissions SET state='rejected', upload_index='5000000001', download_id='3000000001',
      archive_state='pending' WHERE id=$1`, [second])
    const third = await rig.submitted(invoiceId)
    await rig.sql("UPDATE efactura_submissions SET state='unknown' WHERE id=$1", [third])
    const again = await rig.submit(invoiceId)
    assert.deepEqual([again.status, (again.body as Record<string, unknown>).id], [200, third], "unknown is never queued again by submit")
    const history = await ok(rig.server.call("GET", `/api/invoices/${invoiceId}/efactura/submissions`), "history") as
      { current: { id: string }; submissions: ReadonlyArray<{ id: string; state: string }> }
    assert.equal(history.current.id, third)
    assert.deepEqual(history.submissions.map((submission) => submission.state).sort(), ["refused", "rejected", "unknown"])
    assert.equal((await rig.server.call("GET", `/api/efactura/submissions/${first}/response`)).status, 404, "no ZIP before ANAF answers")

    const otherId = await rig.invoice("inv-2")
    const accepted = await rig.submitted(otherId)
    await rig.sql(`UPDATE efactura_submissions SET state='accepted', upload_index='5000000002', download_id='3000000002',
      archive_state='pending' WHERE id=$1`, [accepted])
    const answered = await rig.submit(otherId)
    assert.deepEqual([answered.status, (answered.body as Record<string, unknown>).id], [200, accepted], "accepted is final")
  }))

void test("a correction is submitted as a CreditNote, and its status shows in the register", () => withRig("efs_storno", async (rig) => {
  await rig.connect()
  const invoiceId = await rig.invoice("inv-1")
  const storno = await ok(rig.server.call("POST", `/api/invoices/${invoiceId}/corrections`, { reason: "Anulare" }, "storno-1"), "storno")
  const reply = await rig.submit(String(storno.id), "corrections")
  assert.equal(reply.status, 202, JSON.stringify(reply.body))
  assert.deepEqual([(reply.body as Record<string, unknown>).standard, (reply.body as Record<string, unknown>).documentKind], ["CN", "correction"])
  assert.equal(await rig.status("correction_documents", String(storno.id)), "queued")
  const register = await ok(rig.server.call("GET", "/api/invoice-register"), "register") as
    { items: ReadonlyArray<{ kind: string; eFacturaStatus: unknown }> }
  assert.deepEqual(register.items.map((item) => [item.kind, item.eFacturaStatus]).sort(), [["correction", "queued"], ["invoice", "not_sent"]])
  const xml = await rig.server.call("GET", `/api/efactura/submissions/${String((reply.body as Record<string, unknown>).id)}/xml`)
  assert.equal(xml.status, 200)
  assert.match(String(xml.body), /<CreditNote/u)
  const history = await ok(rig.server.call("GET", `/api/corrections/${String(storno.id)}/efactura/submissions`), "history")
  assert.equal((history.submissions as ReadonlyArray<unknown>).length, 1)
}))
