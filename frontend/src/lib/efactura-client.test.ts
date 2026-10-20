import assert from "node:assert/strict"
import test from "node:test"

import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"
import { createEFacturaClient } from "./efactura-client.ts"

const submission = {
  id: "s/1", environment: "test", documentKind: "correction", documentId: "c/1", standard: "CN", cif: "19999919",
  state: "queued", archiveState: "none", uploadIndex: null, downloadId: null, errors: [], superseded: false,
  xmlSha256: "ab", xmlSize: 10, createdBy: "api-token", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:00.000Z",
}
const connection = {
  status: "disconnected", environment: "test", verifiedCif: null, refreshExpiresAt: null, refreshExpiryWarning: false,
  connectedBy: null, connectedAt: null, attempt: "none",
}

const recorder = (answer: unknown) => {
  const calls: Array<readonly [string, string, TransportOptions | undefined]> = []
  const transport: BrowserTransport = {
    json: (path, options) => { calls.push(["json", path, options]); return Promise.resolve(answer) },
    binary: (path, options) => { calls.push(["binary", path, options]); return Promise.resolve(new Blob([])) },
  }
  return { calls, client: createEFacturaClient(transport) }
}

void test("the connection: a read, a CSRF-signed start answering ANAF's URL, and a CSRF-signed DELETE", async () => {
  const read = recorder(connection)
  assert.equal((await read.client.connection(AbortSignal.abort())).status, "disconnected")
  assert.equal(read.calls[0]?.[1], "/api/efactura/connection")
  const start = recorder({ authorizeUrl: "https://logincert.anaf.ro/anaf-oauth2/v1/authorize?client_id=x" })
  assert.equal(await start.client.startConnection("csrf"), "https://logincert.anaf.ro/anaf-oauth2/v1/authorize?client_id=x")
  assert.deepEqual(start.calls.map(([, path, options]) => [path, options?.method, options?.csrfToken]),
    [["/api/efactura/connection/start", "POST", "csrf"]])
  const off = recorder(connection)
  await off.client.disconnect("csrf")
  assert.deepEqual(off.calls.map(([, path, options]) => [path, options?.method, options?.csrfToken, options?.body]),
    [["/api/efactura/connection", "DELETE", "csrf", undefined]])
})

void test("a start answer that would send the browser anywhere but ANAF is refused before it navigates", async () => {
  await assert.rejects(() => recorder({ authorizeUrl: "https://evil.example/x" }).client.startConnection("csrf"), /invalid authorizeUrl/u)
})

void test("a document's history and submit go to its own kind, the identifier encoded", async () => {
  const history = recorder({ current: submission, submissions: [submission], resubmissions: [] })
  assert.equal((await history.client.history("correction", "c/1", AbortSignal.abort())).current?.id, "s/1")
  assert.equal(history.calls[0]?.[1], "/api/corrections/c%2F1/efactura/submissions")
  const submit = recorder({ ...submission, documentKind: "invoice", documentId: "i-1" })
  await submit.client.submit("csrf", "invoice", "i-1")
  assert.deepEqual(submit.calls.map(([, path, options]) => [path, options?.method, options?.csrfToken]),
    [["/api/invoices/i-1/efactura/submission", "POST", "csrf"]])
})

void test("another document's history is refused rather than shown on this one", async () => {
  const history = recorder({ current: submission, submissions: [submission], resubmissions: [] })
  await assert.rejects(() => history.client.history("correction", "c/2", AbortSignal.abort()), /invalid submissions/u)
})

void test("the files are plain reads asking for XML and ZIP", async () => {
  const files = recorder(undefined)
  await files.client.submittedXml("s/1")
  await files.client.anafResponse("s/1")
  assert.deepEqual(files.calls.map(([kind, path, options]) => [kind, path, options?.accept, options?.method]), [
    ["binary", "/api/efactura/submissions/s%2F1/xml", "application/xml", undefined],
    ["binary", "/api/efactura/submissions/s%2F1/response", "application/zip", undefined],
  ])
})

void test("the reconciliation: candidates by page, and both writes carry the explicit confirmation", async () => {
  const list = recorder({ page: 2, pages: 2, from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z", candidates: [] })
  await list.client.candidates("s/1", 2, AbortSignal.abort())
  assert.equal(list.calls[0]?.[1], "/api/efactura/submissions/s%2F1/candidates?page=2")
  const writes = recorder(submission)
  await writes.client.link("csrf", "s/1", "5001")
  await writes.client.resubmit("csrf", "s/1")
  assert.deepEqual(writes.calls.map(([, path, options]) => [path, options?.method, options?.csrfToken, options?.body]), [
    ["/api/efactura/submissions/s%2F1/link", "POST", "csrf", { uploadIndex: "5001", confirmed: true }],
    ["/api/efactura/submissions/s%2F1/resubmit", "POST", "csrf", { confirmed: true }],
  ])
})
