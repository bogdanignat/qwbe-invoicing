import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { createRequestAuthenticator } from "../auth/auth.ts"
import { migratedFixture } from "../storage/postgres-rig.test-support.ts"
import { handleApiRequest } from "./api.test-support.ts"

const each = { code: "C62", name: "unitate" } as const
const customer = {
  partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" },
}
const line = { description: "Servicii", quantity: "2", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
const draftBody = { customer, series: "QWBE", issueDate: "2026-09-05", dueDate: "2026-09-20", lines: [line, line] }

const fixture = async (label: string) => {
  const rig = await migratedFixture(`idem_${label}`)
  const token = "c".repeat(64)
  const tokenFile = join(rig.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const runtime = {
    authenticate: createRequestAuthenticator(rig.config({ authTokenFile: tokenFile })),
    pool: rig.pool,
    dataDirectory: rig.dataDirectory,
    now: () => new Date("2026-09-05T10:00:00.000Z"),
  }
  const call = (method: string, url: string, body?: unknown, idempotencyKey?: string) =>
    handleApiRequest({ method, url, authorization: `Bearer ${token}`, body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }) }, runtime)
  await call("PUT", "/api/issuer", {
    name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Română", socialCapital: "1000.00", defaultCurrency: "RON", defaultPaymentTermDays: 15,
    vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  })
  await call("POST", "/api/document-series", { documentType: "invoice", series: "QWBE" })
  return { call, close: () => rig.close() }
}

const idOf = (response: { readonly body: unknown }): string => (response.body as { id: string }).id
const codeOf = (response: { readonly body: unknown }): unknown => (response.body as { code: unknown }).code

void test("POST /api/drafts requires an Idempotency-Key and refuses a malformed one", async () => {
  const value = await fixture("key")
  try {
    const missing = await value.call("POST", "/api/drafts", draftBody)
    assert.equal(missing.status, 400)
    assert.equal(codeOf(missing), undefined)
    for (const key of ["sp ace", "k".repeat(256)]) {
      assert.equal((await value.call("POST", "/api/drafts", draftBody, key)).status, 400, key)
    }
    const listed = await value.call("GET", "/api/drafts")
    assert.deepEqual((listed.body as { items: ReadonlyArray<unknown> }).items, [])
  } finally { await value.close() }
})

void test("POST /api/drafts carries the lines in the create request and replays the same draft", async () => {
  const value = await fixture("replay")
  try {
    const created = await value.call("POST", "/api/drafts", draftBody, "http-create")
    assert.equal(created.status, 200)
    assert.equal((created.body as { lines: ReadonlyArray<unknown> }).lines.length, 2)
    assert.equal((created.body as { totalIncludingVat: string }).totalIncludingVat, "484.00")
    const replay = await value.call("POST", "/api/drafts", draftBody, "http-create")
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.body, created.body)
    assert.equal((await value.call("GET", "/api/drafts")).status, 200)
    assert.equal(((await value.call("GET", "/api/drafts")).body as { items: ReadonlyArray<unknown> }).items.length, 1)

    // A draft with no lines at all is a legitimate create; issuing it is not.
    const empty = await value.call("POST", "/api/drafts", { customer, series: "QWBE", issueDate: "2026-09-05" }, "http-empty")
    assert.equal(empty.status, 200)
    assert.deepEqual((empty.body as { lines: ReadonlyArray<unknown> }).lines, [])
    const issued = await value.call("POST", `/api/drafts/${idOf(empty)}/issue`, {}, "http-issue-empty")
    assert.equal(issued.status, 400)
  } finally { await value.close() }
})

void test("a conflicting creation key answers 409 with its code, never a 500", async () => {
  const value = await fixture("conflict")
  try {
    const created = await value.call("POST", "/api/drafts", draftBody, "http-conflict")
    const reused = await value.call("POST", "/api/drafts", { ...draftBody, notes: "Alt" }, "http-conflict")
    assert.equal(reused.status, 409)
    assert.equal(codeOf(reused), "idempotency_key_reused")

    assert.equal((await value.call("DELETE", `/api/drafts/${idOf(created)}`)).status, 200)
    const deleted = await value.call("POST", "/api/drafts", draftBody, "http-conflict")
    assert.equal(deleted.status, 409)
    assert.equal(codeOf(deleted), "draft_creation_result_deleted")
    assert.equal(((await value.call("GET", "/api/drafts")).body as { items: ReadonlyArray<unknown> }).items.length, 0)
  } finally { await value.close() }
})
