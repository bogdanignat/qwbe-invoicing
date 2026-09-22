import assert from "node:assert/strict"
import test from "node:test"

import { OpenApi } from "@effect/platform"

import { applicationHttpApi } from "./http-api.ts"

interface JsonSchema {
  readonly type?: string
  readonly enum?: ReadonlyArray<unknown>
  readonly required?: ReadonlyArray<string>
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly items?: JsonSchema
  readonly anyOf?: ReadonlyArray<JsonSchema>
}

void test("invoice register OpenAPI preserves discriminated nullability and original-reference ownership", () => {
  const spec = OpenApi.fromApi(applicationHttpApi)
  const response = spec.paths["/api/invoice-register"]?.get?.responses[200]
  assert.ok(response)
  const content = response.content as Readonly<Record<string, { readonly schema?: unknown }>> | undefined
  const page = content?.["application/json"]?.schema as JsonSchema | undefined
  assert.ok(page)
  assert.ok(page.required)
  assert.deepEqual(page.required, ["items", "nextCursor"])
  assert.ok(page.properties)
  const items = page.properties.items
  assert.ok(items)
  assert.ok(items.items)
  const row = items.items
  assert.ok(row.anyOf)
  const invoice = row.anyOf.find((variant) => variant.properties?.kind?.enum?.includes("invoice"))
  const correction = row.anyOf.find((variant) => variant.properties?.kind?.enum?.includes("correction"))
  assert.ok(invoice)
  assert.ok(invoice.required)
  assert.ok(invoice.properties)
  assert.equal(invoice.required.includes("originalReference"), false)
  assert.equal(Object.hasOwn(invoice.properties, "originalReference"), false)
  assert.ok(invoice.properties.dueDate)
  assert.ok(invoice.properties.dueDate.anyOf)
  assert.deepEqual(invoice.properties.dueDate.anyOf.map(({ type }) => type), ["string", "null"])
  assert.ok(invoice.properties.eFacturaStatus)
  assert.deepEqual(invoice.properties.eFacturaStatus.enum, ["not_sent", "pending", "sent", "accepted", "rejected"])
  assert.ok(correction)
  assert.ok(correction.required)
  assert.ok(correction.properties)
  assert.equal(correction.required.includes("originalReference"), true)
  assert.equal(correction.properties.dueDate?.type, "null")
  assert.equal(correction.properties.eFacturaStatus?.type, "null")
  assert.ok(correction.properties.originalReference)
  assert.ok(correction.properties.originalReference.required)
  assert.deepEqual(correction.properties.originalReference.required, ["id", "series", "number"])
})
