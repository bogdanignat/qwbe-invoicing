import assert from "node:assert/strict"
import test from "node:test"

import { HttpApi, OpenApi } from "@effect/platform"
import { Schema } from "effect"

import { makeApiDocsResponse } from "./api-docs.ts"
import { applicationHttpApi, operationNames } from "./http-api.ts"
import * as S from "./http-schemas.ts"

const inventory = [
  "GET /api/issuer", "PUT /api/issuer", "GET /api/document-series", "POST /api/document-series",
  "GET /api/unit-of-measures", "GET /api/vat-regimes",
  "GET /api/customers", "GET /api/customers/:id", "POST /api/customers", "PUT /api/customers/:id", "DELETE /api/customers/:id",
  "GET /api/product-presets", "POST /api/product-presets", "PUT /api/product-presets/:id", "DELETE /api/product-presets/:id",
  "GET /api/drafts", "GET /api/drafts/:id", "POST /api/drafts", "PUT /api/drafts/:id", "DELETE /api/drafts/:id",
  "POST /api/drafts/:draftId/lines", "PUT /api/drafts/:draftId/lines/:lineId", "DELETE /api/drafts/:draftId/lines/:lineId",
  "POST /api/drafts/:draftId/issue", "GET /api/invoices/:invoiceId/payments", "POST /api/invoices/:invoiceId/payments", "POST /api/invoices/:invoiceId/payments/:paymentId/reversal",
  "POST /api/invoices/:invoiceId/corrections", "GET /api/invoices/:invoiceId/corrections", "GET /api/corrections/:id",
  "GET /api/invoices", "GET /api/invoices/:id", "POST /api/invoices/:invoiceId/pdf", "GET /api/invoices/:invoiceId/pdf",
  "POST /api/invoices",
  "POST /api/drafts/:draftId/proformas", "GET /api/proformas", "GET /api/proformas/:id",
  "POST /api/proformas", "POST /api/proformas/:id/invoice", "POST /api/proformas/:proformaId/pdf", "GET /api/proformas/:proformaId/pdf",
  "GET /api/session", "POST /api/session", "DELETE /api/session",
].sort()

void test("the contract exposes exactly the current 45 operations", () => {
  const applicationRoutes: Array<{ readonly method: string, readonly operationId: string, readonly path: string }> = []
  HttpApi.reflect(applicationHttpApi, { onGroup() {}, onEndpoint({ endpoint }) {
    applicationRoutes.push({ method: endpoint.method, operationId: endpoint.name, path: endpoint.path })
  } })
  assert.equal(operationNames.length, 45)
  assert.equal(new Set(operationNames).size, 45)
  assert.equal(applicationRoutes.length, 45)
  assert.equal(new Set(applicationRoutes.map((route) => route.operationId)).size, 45)
  assert.ok(operationNames.includes("listVatRegimes"))
  assert.deepEqual(applicationRoutes.map((route) => `${route.method} ${route.path}`).sort(), inventory)
  assert.equal(applicationRoutes.some((route) => route.path === "/api"), false)
})

void test("dueDate contracts accept absent, null, or string input and encode explicit null responses", () => {
  const base = { customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01" }
  assert.doesNotThrow(() => Schema.decodeUnknownSync(S.DraftInput)(base))
  assert.equal(Schema.decodeUnknownSync(S.DraftInput)({ ...base, dueDate: null }).dueDate, null)
  assert.equal(Schema.decodeUnknownSync(S.DraftInput)({ ...base, dueDate: "2026-09-15" }).dueDate, "2026-09-15")
  assert.throws(() => Schema.decodeUnknownSync(S.DraftInput)({ ...base, dueDate: 15 }))
  const draft = {
    id: "draft-1", organizationId: "org-1", customer: { partyType: "individual", name: "Ion", fiscalIdentifier: "",
      address: { countryCode: "RO", city: "Iași", street: "Strada 1" } }, series: "QWBE", issueDate: "2026-09-01",
    dueDate: null, currency: "RON", notes: null, status: "proforma_issued", lines: [], vatBreakdown: [], totalExcludingVat: "0.00",
    vatTotal: "0.00", totalIncludingVat: "0.00",
  } as const
  assert.equal(Schema.encodeSync(S.DraftInvoice)(draft).dueDate, null)
  assert.equal(Schema.encodeSync(S.DraftInvoice)(draft).status, "proforma_issued")
  assert.equal(Schema.encodeSync(S.Proforma)({ ...draft, id: "proforma-1", sourceDraftId: "draft-1", invoiceSeries: "QWBE",
    convertedDraftId: null, convertedInvoiceId: null,
    number: 1, issuedAt: "2026-09-01T00:00:00.000Z", actorId: "user-1", issuer: { name: "Furnizor", fiscalIdentifier: "RO12345674", branding: null,
      legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
      address: { countryCode: "RO", city: "Iași", street: "Strada 2" } } }).convertedDraftId, null)
})

void test("VAT catalogue response exposes legal rates and nullable inference", () => {
  const response = { rates: [
    { code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "TVA standard 21%", effectiveFrom: "2025-08-01" },
    { code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "TVA redus 11%", effectiveFrom: "2025-08-01" },
  ], inferredRegistration: null }
  assert.deepEqual(Schema.encodeSync(S.VatCatalogue)(Schema.decodeUnknownSync(S.VatCatalogue)(response)), response)
  assert.throws(() => Schema.decodeUnknownSync(S.VatCatalogue)({ ...response, inferredRegistration: "yes" }))
})

void test("customer payment terms and monetary product presets have explicit wire types", () => {
  const customer = { partyType: "individual", name: "Ion", fiscalIdentifier: "",
    address: { countryCode: "RO", city: "Iași", street: "Strada 1" } }
  assert.doesNotThrow(() => Schema.decodeUnknownSync(S.CustomerInput)(customer))
  assert.equal(Schema.decodeUnknownSync(S.CustomerInput)({ ...customer, defaultPaymentTermDays: 0 }).defaultPaymentTermDays, 0)
  assert.throws(() => Schema.decodeUnknownSync(S.CustomerInput)({ ...customer, defaultPaymentTermDays: 1.5 }))
  const unitOfMeasure = { code: "HUR", name: "oră" }
  assert.deepEqual(Schema.decodeUnknownSync(S.ProductPresetInput)({ description: "Servicii", unitPrice: "10.00", unitOfMeasure }),
    { description: "Servicii", unitPrice: "10.00", unitOfMeasure })
  assert.throws(() => Schema.decodeUnknownSync(S.ProductPresetInput)({ description: "Servicii", unitPrice: 10, unitOfMeasure }))
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
  const draftResponse = spec.paths["/api/drafts/{id}"]?.get?.responses[200]
  const draftContent = draftResponse?.content as
    | Readonly<Record<string, { readonly schema?: { readonly properties?: { readonly status?: { readonly enum?: unknown } } } }>>
    | undefined
  assert.deepEqual(draftContent?.["application/json"]?.schema?.properties?.status?.enum, ["draft", "issued", "proforma_issued"])
  assert.ok(spec.paths["/api/customers"].post?.parameters.some((parameter) => parameter.name === "x-csrf-token"))
  assert.ok(spec.paths["/api/session"].delete?.parameters.some((parameter) => parameter.name === "x-csrf-token" && parameter.required))
  for (const path of ["/api/drafts/{draftId}/issue", "/api/invoices", "/api/drafts/{draftId}/proformas",
    "/api/proformas", "/api/proformas/{id}/invoice", "/api/invoices/{invoiceId}/corrections"]) {
    assert.ok(spec.paths[path]?.post?.parameters.some((parameter) => parameter.name === "idempotency-key" && parameter.required),
      `${path} must require Idempotency-Key`)
  }
  const pdfPath = spec.paths["/api/invoices/{invoiceId}/pdf"]
  assert.ok(pdfPath)
  const pdfContent = pdfPath.get?.responses[200]?.content as
    | Readonly<Record<string, { readonly schema: unknown }>>
    | undefined
  assert.deepEqual(pdfContent?.["application/pdf"]?.schema, {
    type: "string", format: "binary",
  })
  const proformaPdfContent = spec.paths["/api/proformas/{proformaId}/pdf"]?.get?.responses[200]?.content as
    | Readonly<Record<string, { readonly schema: unknown }>> | undefined
  assert.deepEqual(proformaPdfContent?.["application/pdf"]?.schema, { type: "string", format: "binary" })

  const common = ["200", "400", "401", "403", "429", "500", "503"]
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
  for (const path of ["/api/document-series", "/api/unit-of-measures", "/api/vat-regimes", "/api/invoices/{invoiceId}/corrections"]) {
    expectStatuses("get", path)
  }
  for (const path of ["/api/customers", "/api/product-presets", "/api/drafts", "/api/invoices", "/api/proformas"]) {
    expectStatuses("get", path, ["400"])
  }
  for (const path of ["/api/issuer", "/api/customers/{id}", "/api/drafts/{id}", "/api/invoices/{invoiceId}/payments", "/api/corrections/{id}", "/api/invoices/{id}", "/api/invoices/{invoiceId}/pdf", "/api/proformas/{id}", "/api/proformas/{proformaId}/pdf"]) {
    expectStatuses("get", path, ["404"])
  }
  for (const [method, path] of [["put", "/api/issuer"], ["post", "/api/customers"], ["post", "/api/product-presets"]] as const) {
    expectStatuses(method, path, ["413"])
  }
  expectStatuses("post", "/api/document-series", ["409", "413"])
  for (const [method, path] of [["put", "/api/customers/{id}"], ["put", "/api/product-presets/{id}"],
    ["delete", "/api/product-presets/{id}"]] as const) expectStatuses(method, path, ["404", "413"])
  for (const [method, path] of [["post", "/api/drafts"]] as const) {
    expectStatuses(method, path, ["404", "413"])
  }
  for (const path of ["/api/invoices", "/api/proformas"]) expectStatuses("post", path, ["404", "409", "413"])
  for (const [method, path] of [
    ["delete", "/api/customers/{id}"], ["put", "/api/drafts/{id}"], ["delete", "/api/drafts/{id}"],
    ["post", "/api/drafts/{draftId}/lines"], ["put", "/api/drafts/{draftId}/lines/{lineId}"],
    ["delete", "/api/drafts/{draftId}/lines/{lineId}"], ["post", "/api/drafts/{draftId}/issue"],
    ["post", "/api/invoices/{invoiceId}/corrections"], ["post", "/api/invoices/{invoiceId}/pdf"],
    ["post", "/api/drafts/{draftId}/proformas"], ["post", "/api/proformas/{id}/invoice"],
    ["post", "/api/proformas/{proformaId}/pdf"],
  ] as const) expectStatuses(method, path, ["404", "409", "413"])
  expectStatuses("get", "/api/session", [], ["200", "400", "401", "500", "503"])
  expectStatuses("post", "/api/session", ["413", "429"])
  expectStatuses("delete", "/api/session", [], ["200", "400", "401", "403", "500", "503"])
  const throttledLogin = spec.paths["/api/session"].post.responses[429]
  assert.match(throttledLogin?.description ?? "", /Retry-After/)
  assert.deepEqual(throttledLogin?.content?.["application/json"]?.schema, {
    type: "object",
    required: ["error"],
    properties: { error: { type: "string", enum: ["too_many_attempts"] } },
    additionalProperties: false,
    description: "Authentication cooldown is active. Retry-After is an integer delay of 1-30 seconds.",
  })
  let throttledOperations = 0
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      const response = operation.responses[429] as (typeof operation.responses[number] & {
        readonly headers?: Readonly<Record<string, unknown>>
      }) | undefined
      if (response === undefined) continue
      throttledOperations += 1
      assert.deepEqual(response.headers, {
        "Retry-After": {
          description: "Cooldown remaining in whole seconds.",
          required: true,
          schema: { type: "integer", minimum: 1, maximum: 30 },
        },
      }, operation.operationId)
    }
  }
  assert.equal(throttledOperations, operationNames.length - 2)

  const tagStatuses = new Map<string, Set<string>>()
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        const json = JSON.stringify(response)
        for (const tag of ["ValidationFailure", "invalid_json", "invalid_credentials", "AuthenticationRequired", "PermissionDenied", "DocumentsPermissionDenied", "csrf_validation_failed", "origin_not_allowed", "ResourceNotFound", "DocumentNotFound", "DomainConflict", "ArtifactConflict", "request_body_too_large", "too_many_attempts", "PersistenceFailure", "DocumentPersistenceFailure", "DocumentRenderingFailure", "internal_failure", "OrganizationContextMissing", "not_ready"]) {
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
    request_body_too_large: ["413"], too_many_attempts: ["429"], PersistenceFailure: ["500"], DocumentPersistenceFailure: ["500"],
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

void test("notes contract mirrors the runtime rules for whitespace, length, and invisible separators", () => {
  const base = { customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01" }
  const decode = (notes: unknown) => Schema.decodeUnknownSync(S.DraftInput)({ ...base, notes })
  assert.equal(decode(null).notes, null)
  assert.equal(decode("Linie unu\nLinie doi").notes, "Linie unu\nLinie doi")
  for (const notes of ["", " marginal ", "x".repeat(501), 7, "tab\tstop", "linie\u2028separata", "paragraf\u2029separat"]) {
    assert.throws(() => decode(notes), String(notes))
  }
})
