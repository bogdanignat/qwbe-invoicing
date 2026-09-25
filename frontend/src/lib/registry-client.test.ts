import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createRegistryClient, type CustomerInput, type ProductPresetInput } from "./registry-client.ts"
import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"

/**
 * The six master-data writes, asserted at the transport boundary.
 *
 * Nothing above this file can see which path a write reaches, under which
 * method, or with which headers: the hooks mock the client away. A `PUT` sent
 * as a `POST` would create a second record instead of editing one, a missing
 * CSRF token is a `403` the screen cannot explain, and an `idempotency-key`
 * here would be a header the master-data endpoints never asked for.
 */

interface Call {
  readonly path: string
  readonly options: TransportOptions | undefined
}

const recorder = (answer: (call: Call) => unknown) => {
  const calls: Call[] = []
  const transport: BrowserTransport = {
    json: (path, options) => Promise.resolve().then(() => {
      calls.push({ path, options })
      return answer(calls[calls.length - 1] as Call)
    }),
    binary: () => { throw new Error("unscripted binary") },
  }
  return { calls, transport }
}

const each = { code: "C62", name: "unitate" }
const address = { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }
const customer = {
  id: "cus-1", organizationId: "org-1", partyType: "company", name: "Alfa",
  fiscalIdentifier: "12345674", vatRegistered: true, address, defaultPaymentTermDays: 15,
}
const preset = {
  id: "prs-1", organizationId: "org-1", description: "Carte", unitPrice: "40.00",
  unitOfMeasure: each, preferredVatRateCode: "RO_REDUCED",
}

const customerInput: CustomerInput = {
  partyType: "company", name: "Alfa", fiscalIdentifier: "12345674", vatRegistered: true, address,
}
const presetInput: ProductPresetInput = { description: "Carte", unitPrice: "40.00", unitOfMeasure: each }

const answerFor = (call: Call): unknown => {
  if (call.options?.method === "DELETE") return { deleted: true }
  return call.path.startsWith("/api/customers") ? customer : preset
}

const sent = (call: Call | undefined): ReadonlyArray<unknown> => {
  if (call?.options === undefined) throw new Error("expected a write call")
  return [call.path, call.options.method, call.options.csrfToken, call.options.idempotencyKey]
}

void test("each master-data write reaches its own path and method, under the session's CSRF token", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createRegistryClient(transport)

  assert.equal((await client.createCustomer("csrf-1", customerInput)).id, "cus-1")
  assert.deepEqual(sent(calls[0]), ["/api/customers", "POST", "csrf-1", undefined])
  assert.equal((await client.updateCustomer("csrf-1", "cus-1", customerInput)).name, "Alfa")
  assert.deepEqual(sent(calls[1]), ["/api/customers/cus-1", "PUT", "csrf-1", undefined])
  await client.deleteCustomer("csrf-1", "cus-1")
  assert.deepEqual(sent(calls[2]), ["/api/customers/cus-1", "DELETE", "csrf-1", undefined])

  assert.equal((await client.createProductPreset("csrf-1", presetInput)).id, "prs-1")
  assert.deepEqual(sent(calls[3]), ["/api/product-presets", "POST", "csrf-1", undefined])
  assert.equal((await client.updateProductPreset("csrf-1", "prs-1", presetInput)).description, "Carte")
  assert.deepEqual(sent(calls[4]), ["/api/product-presets/prs-1", "PUT", "csrf-1", undefined])
  await client.deleteProductPreset("csrf-1", "prs-1")
  assert.deepEqual(sent(calls[5]), ["/api/product-presets/prs-1", "DELETE", "csrf-1", undefined])
})

void test("the body is the payload itself, and a delete carries none", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createRegistryClient(transport)
  await client.createCustomer("csrf", customerInput)
  await client.updateProductPreset("csrf", "prs-1", presetInput)
  await client.deleteCustomer("csrf", "cus-1")
  assert.equal(calls[0]?.options?.body, customerInput)
  assert.equal(calls[1]?.options?.body, presetInput)
  // No `content-type` is attached for a body the endpoint does not read.
  assert.equal(calls[2]?.options?.body, undefined)
})

void test("an identifier travels encoded: it is a path segment, not a path", async () => {
  const { calls, transport } = recorder(answerFor)
  const client = createRegistryClient(transport)
  await client.updateCustomer("csrf", "cus 1/a", customerInput)
  await client.deleteProductPreset("csrf", "prs 1/a")
  assert.deepEqual(
    [calls[0]?.path, calls[1]?.path],
    ["/api/customers/cus%201%2Fa", "/api/product-presets/prs%201%2Fa"],
  )
})

void test("a refusal from the server reaches the caller as it came", async () => {
  const conflict = new ApiFailure({ message: "clientul are facturi", status: 409, code: "customer_in_use" })
  const { transport } = recorder(() => { throw conflict })
  const client = createRegistryClient(transport)
  for (const write of [
    () => client.deleteCustomer("csrf", "cus-1"),
    () => client.createProductPreset("csrf", presetInput),
  ]) {
    await assert.rejects(write(), (error: unknown) => {
      // Classified, not wrapped: the screen reads the message and the status off it.
      assert.equal(error, conflict)
      return true
    })
  }
})

void test("an answer that drifted from the contract is refused at the boundary", async () => {
  const { transport } = recorder((call) => call.path.startsWith("/api/customers")
    ? { ...customer, id: 7 }
    : { ...preset, id: 7 })
  const client = createRegistryClient(transport)
  await assert.rejects(client.createCustomer("csrf", customerInput), /invalid id/u)
  await assert.rejects(client.createProductPreset("csrf", presetInput), /invalid id/u)
  const { transport: refused } = recorder(() => ({ deleted: false }))
  await assert.rejects(createRegistryClient(refused).deleteCustomer("csrf", "cus-1"), /invalid deleted/u)
})
