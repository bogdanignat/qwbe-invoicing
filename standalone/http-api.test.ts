import assert from "node:assert/strict"
import test from "node:test"

import { OpenApi } from "@effect/platform"

import { makeApiDocsResponse } from "./api-docs.ts"
import { applicationRoutes, matchApplicationRoute } from "./api-route-adapter.ts"
import { applicationHttpApi, operationNames } from "./http-api.ts"

const inventory = [
  "GET /api/issuer", "PUT /api/issuer", "GET /api/document-series", "POST /api/document-series",
  "GET /api/customers", "GET /api/customers/:id", "POST /api/customers", "DELETE /api/customers/:id",
  "GET /api/drafts", "GET /api/drafts/:id", "POST /api/drafts", "PUT /api/drafts/:id", "DELETE /api/drafts/:id",
  "POST /api/drafts/:draftId/lines", "PUT /api/drafts/:draftId/lines/:lineId", "DELETE /api/drafts/:draftId/lines/:lineId",
  "POST /api/drafts/:draftId/issue", "GET /api/invoices/:invoiceId/payments", "POST /api/invoices/:invoiceId/payments",
  "POST /api/invoices/:invoiceId/corrections", "GET /api/invoices/:invoiceId/corrections", "GET /api/corrections/:id",
  "GET /api/invoices", "GET /api/invoices/:id", "POST /api/invoices/:invoiceId/pdf", "GET /api/invoices/:invoiceId/pdf",
  "GET /api/session", "POST /api/session", "DELETE /api/session",
].sort()

void test("the contract exposes exactly the current 29 operations", () => {
  assert.equal(operationNames.length, 29)
  assert.equal(new Set(operationNames).size, 29)
  assert.equal(applicationRoutes.length, 29)
  assert.equal(new Set(applicationRoutes.map((route) => route.operationId)).size, 29)
  assert.deepEqual(applicationRoutes.map((route) => `${route.method} ${route.path}`).sort(), inventory)
  assert.equal(applicationRoutes.some((route) => route.path === "/api"), false)
})

void test("the reflected matcher handles precedence, raw IDs, 405, and 404", () => {
  assert.deepEqual(matchApplicationRoute("GET", "/api/invoices"), {
    kind: "matched", operationId: "listIssuedInvoices", pathParams: {},
  })
  assert.deepEqual(matchApplicationRoute("GET", "/api/invoices/a%2Fb"), {
    kind: "matched", operationId: "getIssuedInvoice", pathParams: { id: "a%2Fb" },
  })
  assert.deepEqual(matchApplicationRoute("GET", "/api/invoices/x/pdf"), {
    kind: "matched", operationId: "downloadInvoicePdf", pathParams: { invoiceId: "x" },
  })
  assert.deepEqual(matchApplicationRoute("PATCH", "/api/session"), { kind: "method_not_allowed" })
  assert.deepEqual(matchApplicationRoute("GET", "/api/invoices/x/pdf/extra"), { kind: "not_found" })
  assert.deepEqual(matchApplicationRoute("GET", "/api"), { kind: "not_found" })
})

void test("OpenAPI 3.1 mirrors paths, PDF encoding, and authentication metadata", () => {
  const spec = OpenApi.fromApi(applicationHttpApi)
  const openApiInventory = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`)).sort()
  assert.equal(spec.openapi, "3.1.0")
  assert.deepEqual(openApiInventory, inventory)
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, { type: "http", scheme: "bearer", description: "Authorization: Bearer <standalone API token>" })
  assert.deepEqual(spec.components.securitySchemes.sessionCookie, { type: "apiKey", name: "qwbe_session", in: "cookie", description: "Opaque browser session cookie" })
  assert.deepEqual(spec.paths["/api/customers"]?.get?.security, [{ bearerAuth: [] }, { sessionCookie: [] }])
  assert.deepEqual(spec.paths["/api/session"]?.post?.security, [])
  assert.deepEqual(spec.paths["/api/session"].get?.security, [{ sessionCookie: [] }])
  assert.ok(spec.paths["/api/customers"].post?.parameters.some((parameter) => parameter.name === "x-csrf-token"))
  assert.ok(spec.paths["/api/session"].delete?.parameters.some((parameter) => parameter.name === "x-csrf-token" && parameter.required))
  const pdfPath = spec.paths["/api/invoices/{invoiceId}/pdf"]
  assert.ok(pdfPath)
  const pdfContent = pdfPath.get?.responses[200]?.content as
    | Readonly<Record<string, { readonly schema: unknown }>>
    | undefined
  assert.deepEqual(pdfContent?.["application/pdf"]?.schema, {
    type: "string", format: "binary",
  })

  const common = ["200", "400", "401", "403", "500", "503"]
  const expectStatuses = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    extras: ReadonlyArray<string> = [],
    base: ReadonlyArray<string> = common,
  ) => {
    const pathItem = spec.paths[path]
    assert.ok(pathItem, `${path} is absent`)
    const operation = pathItem[method]
    assert.ok(operation, `${method.toUpperCase()} ${path} is absent`)
    assert.deepEqual(Object.keys(operation.responses).sort(), [...new Set([...base, ...extras])].sort())
  }
  for (const path of ["/api/document-series", "/api/customers", "/api/drafts", "/api/invoices/{invoiceId}/corrections", "/api/invoices"]) {
    expectStatuses("get", path)
  }
  for (const path of ["/api/issuer", "/api/customers/{id}", "/api/drafts/{id}", "/api/invoices/{invoiceId}/payments", "/api/corrections/{id}", "/api/invoices/{id}", "/api/invoices/{invoiceId}/pdf"]) {
    expectStatuses("get", path, ["404"])
  }
  for (const [method, path] of [["put", "/api/issuer"], ["post", "/api/customers"]] as const) {
    expectStatuses(method, path, ["413"])
  }
  expectStatuses("post", "/api/document-series", ["409", "413"])
  for (const [method, path] of [["post", "/api/drafts"], ["post", "/api/invoices/{invoiceId}/payments"]] as const) {
    expectStatuses(method, path, ["404", "413"])
  }
  for (const [method, path] of [
    ["delete", "/api/customers/{id}"], ["put", "/api/drafts/{id}"], ["delete", "/api/drafts/{id}"],
    ["post", "/api/drafts/{draftId}/lines"], ["put", "/api/drafts/{draftId}/lines/{lineId}"],
    ["delete", "/api/drafts/{draftId}/lines/{lineId}"], ["post", "/api/drafts/{draftId}/issue"],
    ["post", "/api/invoices/{invoiceId}/corrections"], ["post", "/api/invoices/{invoiceId}/pdf"],
  ] as const) expectStatuses(method, path, ["404", "409", "413"])
  expectStatuses("get", "/api/session", [], ["200", "400", "401", "500", "503"])
  expectStatuses("post", "/api/session", ["413"])
  expectStatuses("delete", "/api/session", [], ["200", "400", "401", "403", "500", "503"])

  const tagStatuses = new Map<string, Set<string>>()
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        const json = JSON.stringify(response)
        for (const tag of ["ValidationFailure", "invalid_json", "invalid_credentials", "AuthenticationRequired", "PermissionDenied", "DocumentsPermissionDenied", "csrf_validation_failed", "origin_not_allowed", "ResourceNotFound", "DocumentNotFound", "DomainConflict", "ArtifactConflict", "request_body_too_large", "PersistenceFailure", "DocumentPersistenceFailure", "DocumentRenderingFailure", "internal_failure", "OrganizationContextMissing", "not_ready"]) {
          if (!json.includes(tag)) continue
          const statuses = tagStatuses.get(tag) ?? new Set<string>()
          statuses.add(status)
          tagStatuses.set(tag, statuses)
        }
      }
    }
  }
  const expectedTagStatuses: Readonly<Record<string, ReadonlyArray<string>>> = {
    ValidationFailure: ["400"], invalid_json: ["400"], invalid_credentials: ["400", "401"],
    AuthenticationRequired: ["401"], PermissionDenied: ["403"], DocumentsPermissionDenied: ["403"],
    csrf_validation_failed: ["403"], origin_not_allowed: ["403"], ResourceNotFound: ["404"],
    DocumentNotFound: ["404"], DomainConflict: ["409"], ArtifactConflict: ["409"],
    request_body_too_large: ["413"], PersistenceFailure: ["500"], DocumentPersistenceFailure: ["500"],
    DocumentRenderingFailure: ["500"], internal_failure: ["500"], OrganizationContextMissing: ["503"],
    not_ready: ["503"],
  }
  for (const [tag, statuses] of Object.entries(expectedTagStatuses)) {
    assert.deepEqual([...tagStatuses.get(tag) ?? []].sort(), [...statuses].sort(), tag)
  }
})

void test("Swagger materialization recreates a disposed handler after failure", async () => {
  let attempts = 0
  let disposals = 0
  const docs = makeApiDocsResponse(() => ({
    handler: () => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new Error("first render failed"))
        : Promise.resolve(new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }))
    },
    dispose: () => { disposals += 1; return Promise.resolve() },
  }))

  await assert.rejects(docs(), /first render failed/)
  const response = await docs()
  assert.equal(response.status, 200)
  assert.equal(Buffer.from(response.body).toString("utf8"), "<html>ok</html>")
  assert.equal(attempts, 2)
  assert.equal(disposals, 2)
})
