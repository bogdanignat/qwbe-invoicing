import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"

import { startServer } from "./http.ts"
import type { PluginSelection } from "../plugins.ts"
import type { TestFixture } from "../storage/postgres-rig.test-support.ts"

/**
 * A real server on a real database for the `QWBE_PLUGINS` suites. The selection
 * reaches the server only through `RuntimeConfig.plugins`, exactly as `serve`
 * hands it over.
 */

const token = "q".repeat(64)
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
// Yesterday in UTC is never in the future, whatever zone the fiscal "today" is read in.
export const issueDate = day(-1)
export const dueDate = day(14)
export const customer = { partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } }
export const lines = [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "HUR", name: "oră" },
  vatRateCode: "RO_STANDARD" }]
export const payment = { amount: "50.00", currency: "RON", paymentDate: issueDate, method: "transfer" }

export interface Reply { readonly status: number, readonly type: string, readonly body: unknown }
export interface Served {
  readonly call: (method: string, path: string, body?: unknown, idempotencyKey?: string) => Promise<Reply>
  readonly close: () => Promise<void>
  /** For a test that sends its own headers: the server's origin and the session cookie. */
  readonly origin: string
  readonly cookie: string
}

/** Start, prove readiness, log in: the session cookie and its CSRF token carry every later call. */
export const serve = async (fixture: TestFixture, plugins: PluginSelection): Promise<Served> => {
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const running = await startServer(fixture.config({ port: 0, authTokenFile: tokenFile, plugins }), fixture.pool,
    undefined, undefined, { barrierHeld: () => true })
  try {
    const origin = `http://127.0.0.1:${String((running.server.address() as AddressInfo).port)}`
    assert.equal((await fetch(`${origin}/health/ready`)).status, 200)
    const login = await fetch(`${origin}/api/session`, { method: "POST",
      headers: { "content-type": "application/json", origin }, body: JSON.stringify({ token }) })
    assert.equal(login.status, 200)
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? ""
    const { csrfToken } = await login.json() as { readonly csrfToken: string }
    const call = async (method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<Reply> => {
      const headers: Record<string, string> = { cookie, origin }
      if (method !== "GET") Object.assign(headers, { "content-type": "application/json", "x-csrf-token": csrfToken })
      if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey
      const response = await fetch(`${origin}${path}`, { method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const type = response.headers.get("content-type") ?? ""
      return { status: response.status, type,
        body: type.includes("json") ? await response.json() : type.includes("pdf") ? undefined : await response.text() }
    }
    return { call, close: running.close, origin, cookie }
  } catch (error) {
    await running.close()
    throw error
  }
}

export const ok = async (reply: Promise<Reply>, what: string): Promise<Record<string, unknown>> => {
  const { status, body } = await reply
  assert.equal(status, 200, `${what}: ${JSON.stringify(body)}`)
  return body as Record<string, unknown>
}

export const seed = async ({ call }: Served): Promise<void> => {
  await ok(call("PUT", "/api/issuer", { name: "Furnizor SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl",
    tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
    socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15,
    vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null }), "issuer")
  await ok(call("POST", "/api/document-series", { documentType: "invoice", series: "QWBE" }), "invoice series")
  await ok(call("POST", "/api/document-series", { documentType: "proforma", series: "PRO" }), "proforma series")
}

export const issueInvoice = (call: Served["call"], key: string) => ok(call("POST", "/api/invoices",
  { customer, series: "QWBE", issueDate, dueDate, currency: "RON", lines }, key), "issue invoice")

/** The spec embedded in the Swagger page this installation serves. */
export const documentedPaths = async (call: Served["call"]): Promise<ReadonlyArray<string>> => {
  const { status, body } = await call("GET", "/api")
  assert.equal(status, 200)
  const spec = /<script id="swagger-spec" type="application\/json">([\s\S]*?)<\/script>/u.exec(String(body))?.[1]
  assert.ok(spec !== undefined, "the docs page embeds its spec")
  return Object.keys((JSON.parse(spec) as { paths: Record<string, unknown> }).paths)
}
