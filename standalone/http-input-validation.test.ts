import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { OpenApi } from "@effect/platform"
import { Either, ParseResult, Schema } from "effect"

import { ValidationFailure } from "../cube/invoicing/index.ts"
import * as A from "./api-inputs.ts"
import { handleApiRequest } from "./api.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applicationHttpApi } from "./http-api.ts"
import * as S from "./http-schemas.ts"
import { applyMigrations } from "./migrations.ts"

const customer = { partyType: "company", name: "Client", fiscalIdentifier: " ro87654329 ",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1" } }
const source = { app: "shop", kind: "order", id: "123" }
const line = { description: "Servicii", quantity: "1", unitPrice: "10.00",
  unitOfMeasure: { code: "HUR", name: "oră" }, vatRateCode: "RO_STANDARD" }
const draft = { customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01" }
const authoring = { ...draft, currency: "RON", lines: [line] }
const issuer = { name: "Furnizor", fiscalIdentifier: " ro12345674 ", address: customer.address,
  legalForm: "srl" as const, tradeRegistryNumber: " j22/123/2020 ", iban: " ro49 aaaa 1b31 0075 9384 0000 ",
  bankName: " Banca Română ", socialCapital: "1000",
  defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatConfigurations: [{ code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01" }], branding: null }

interface InputCase {
  readonly name: string
  readonly schema: Schema.Schema.AnyNoContext
  readonly decode: (value: unknown) => unknown
  readonly value: Readonly<Record<string, unknown>>
  readonly ids?: Readonly<Record<string, string>>
}
const inputs: ReadonlyArray<InputCase> = [
  { name: "issuer", schema: S.IssuerInput, decode: A.issuerInput, value: issuer },
  { name: "customer", schema: S.CustomerInput, decode: A.customerInput, value: customer },
  { name: "preset", schema: S.ProductPresetInput, decode: A.productPresetInput, value: line },
  { name: "series", schema: S.DocumentSeriesInput, decode: A.documentSeriesInput, value: { documentType: "invoice", series: "QWBE" } },
  { name: "draft", schema: S.DraftInput, decode: A.draftInput, value: draft },
  { name: "update draft", schema: S.UpdateDraftInput, decode: (value) => A.updateDraftInput("draft-1", value), value: draft, ids: { draftId: "draft-1" } },
  { name: "line", schema: S.DraftLineInput, decode: (value) => A.lineInput("draft-1", value), value: line, ids: { draftId: "draft-1" } },
  { name: "update line", schema: S.DraftLineInput, decode: (value) => A.updateLineInput("draft-1", "line-1", value), value: line,
    ids: { draftId: "draft-1", lineId: "line-1" } },
  { name: "payment", schema: S.PaymentInput, decode: (value) => A.paymentInput("invoice-1", value),
    value: { amount: "10.00", currency: "RON", paymentDate: "2026-09-01", method: "bank_transfer", externalReference: "ref", note: "Plată" }, ids: { invoiceId: "invoice-1" } },
  { name: "reversal", schema: S.ReversalInput, decode: (value) => A.reversalInput("invoice-1", "payment-1", value), value: {},
    ids: { invoiceId: "invoice-1", paymentId: "payment-1" } },
  { name: "correction", schema: S.CorrectionInput, decode: (value) => A.correctionInput("invoice-1", value), value: { reason: "Retur", source },
    ids: { originalInvoiceId: "invoice-1" } },
  { name: "issue proforma", schema: S.IssueProformaInput, decode: (value) => A.issueProformaInput("draft-1", value), value: { series: "PRO" }, ids: { draftId: "draft-1" } },
  { name: "author invoice", schema: S.AuthoringDocumentInput, decode: A.authoringInvoiceInput, value: authoring },
  { name: "author proforma", schema: S.AuthoringProformaInput, decode: A.authoringProformaInput, value: { ...authoring, proformaSeries: "PRO" } },
  { name: "empty", schema: S.EmptyInput, decode: A.emptyInput, value: {} },
]

void test("issuer transport requires the raw branding shape", () => {
  assert.deepEqual(A.issuerInput({ ...issuer, branding: { text: "Marcă", image: { dataBase64: "aGVsbG8=" } } }).branding,
    { text: "Marcă", image: { dataBase64: "aGVsbG8=" } })
  assert.throws(() => { A.issuerInput({ ...issuer, branding: undefined }) }, ValidationFailure)
  assert.throws(() => { A.issuerInput({ ...issuer, branding: { text: null, image: { pngBase64: "x", width: 1, height: 1 } } }) }, ValidationFailure)
})

void test("issuer transport requires explicit legal form and preserves legal-detail input for domain validation", () => {
  const decoded = A.issuerInput(issuer)
  assert.equal(decoded.legalForm, "srl")
  assert.equal(decoded.tradeRegistryNumber, issuer.tradeRegistryNumber)
  assert.equal(decoded.iban, issuer.iban)
  assert.equal(decoded.bankName, issuer.bankName)
  assert.equal(decoded.socialCapital, issuer.socialCapital)
  for (const value of [undefined, null, "SRL", "sa"]) {
    const raw = { ...issuer, legalForm: value }
    assert.deepEqual(issuesOf(() => A.issuerInput(raw)), schemaIssues(S.IssuerInput, raw))
  }
})

const issuesOf = (decode: () => unknown): ReadonlyArray<string> => {
  try { decode() } catch (error) {
    assert.ok(error instanceof ValidationFailure)
    return error.issues
  }
  assert.fail("expected ValidationFailure")
}
const schemaIssues = (schema: Schema.Schema.AnyNoContext, value: unknown) => {
  const result = Schema.decodeUnknownEither(schema, { errors: "all" })(value)
  assert.ok(Either.isLeft(result))
  return ParseResult.ArrayFormatter.formatErrorSync(result.left).map(({ path, message }) =>
    path.length === 0 ? message : `${path.join(".")}: ${message}`)
}

for (const { name, schema, decode, value, ids } of inputs) {
  void test(`${name}: the adapter uses the contract, strips extras, and owns path IDs`, () => {
    const raw = { ...value, extra: "ignored", draftId: "spoof", lineId: "spoof", invoiceId: "spoof", paymentId: "spoof", originalInvoiceId: "spoof" }
    const decoded: unknown = Schema.decodeUnknownSync(schema)(raw)
    assert.deepEqual(decode(raw), { ...decoded as object, ...ids })
    assert.equal(Object.hasOwn(decode(raw) as object, "extra"), false)
  })
  void test(`${name}: non-object bodies use the stable root issue`, () => {
    for (const value of [undefined, null, [], [1], "text", 0, true]) {
      assert.deepEqual(issuesOf(() => decode(value)), ["request body must be a JSON object"])
      assert.deepEqual(schemaIssues(schema, value), ["request body must be a JSON object"])
    }
  })
}

const buyerInputs = inputs.filter(({ name }) => ["draft", "update draft", "author invoice", "author proforma"].includes(name))
void test("every buyer contract requires exactly one buyer and normalizes inline fiscal identifiers", () => {
  for (const { schema, decode, value } of buyerInputs) {
    const withoutBuyer = { ...value }
    Reflect.deleteProperty(withoutBuyer, "customerId")
    for (const raw of [withoutBuyer, { ...value, customer }]) {
      assert.deepEqual(issuesOf(() => decode(raw)), ["exactly one of customerId or customer is required"])
      assert.deepEqual(schemaIssues(schema, raw), ["exactly one of customerId or customer is required"])
    }
    const inline = decode({ ...withoutBuyer, customer }) as { customer: { fiscalIdentifier: string } }
    assert.equal(inline.customer.fiscalIdentifier, "RO87654329")
    for (const raw of [{ ...value, customerId: null }, { ...withoutBuyer, customer: null }]) {
      assert.deepEqual(issuesOf(() => decode(raw)), schemaIssues(schema, raw))
    }
  }
  assert.equal(A.issuerInput(issuer).fiscalIdentifier, "RO12345674")
  assert.equal(A.customerInput(customer).fiscalIdentifier, "RO87654329")
})

void test("notes keep null/omission/paragraphs and collect every rule in stable order", () => {
  for (const { schema, decode, value } of buyerInputs) {
    for (const notes of [null, "Linie unu\nLinie doi", "x".repeat(500)]) {
      assert.equal((decode({ ...value, notes }) as { notes: unknown }).notes, notes)
    }
    assert.equal(Object.hasOwn(decode(value) as object, "notes"), false)
    for (const notes of ["", " ", " marginal ", "x".repeat(501), "a\tb", "a\rb", "a\u0000b", "a\u007fb", "a\u0085b", "a\u2028b", "a\u2029b", 7, false, [], {}]) {
      const raw = { ...value, notes }
      assert.deepEqual(issuesOf(() => decode(raw)), schemaIssues(schema, raw))
    }
    assert.deepEqual(issuesOf(() => decode({ ...value, notes: "\t".repeat(501) })), [
      "notes: notes is required", "notes: notes must not have surrounding whitespace",
      "notes: notes must be at most 500 characters", "notes: notes must not contain control characters",
    ])
  }
})

void test("omitted, nullable and exact optional fields retain their wire semantics", () => {
  assert.equal(Object.hasOwn(A.customerInput(customer), "defaultPaymentTermDays"), false)
  assert.equal(A.customerInput({ ...customer, defaultPaymentTermDays: 0 }).defaultPaymentTermDays, 0)
  for (const { schema, decode, value } of buyerInputs) {
    assert.equal(Object.hasOwn(decode(value) as object, "dueDate"), false)
    for (const dueDate of [null, "2026-09-15"]) {
      assert.equal((decode({ ...value, dueDate }) as { dueDate: unknown }).dueDate, dueDate)
    }
    for (const field of ["notes", "dueDate", "source"]) {
      const raw = { ...value, [field]: undefined }
      assert.deepEqual(issuesOf(() => decode(raw)), schemaIssues(schema, raw))
    }
  }
  assert.equal(A.updateDraftInput("draft-1", { ...draft, source: null }).source, null)
  assert.deepEqual(A.draftInput({ ...draft, source }).source, source)
  issuesOf(() => A.draftInput({ ...draft, source: null }))
  issuesOf(() => A.customerInput({ ...customer, defaultPaymentTermDays: 1.5 }))
  issuesOf(() => A.authoringInvoiceInput({ ...authoring, currency: "EUR" }))
})

void test("nested object and array errors all survive with indexed paths", () => {
  const raw = { ...authoring, lines: [
    { ...line, quantity: 1, unitOfMeasure: { code: 2, name: false } },
    { ...line, unitPrice: 10, vatRateCode: null },
  ] }
  const issues = issuesOf(() => A.authoringInvoiceInput(raw))
  assert.equal(issues.length, 5)
  assert.deepEqual(issues.map((issue) => issue.split(":")[0]), [
    "lines.0.quantity", "lines.0.unitOfMeasure.code", "lines.0.unitOfMeasure.name", "lines.1.unitPrice", "lines.1.vatRateCode",
  ])
  assert.deepEqual(issues, schemaIssues(S.AuthoringDocumentInput, raw))
  const badIssuer = { ...issuer, address: { countryCode: 0, city: null },
    vatConfigurations: [{ code: 1, rate: 21, effectiveFrom: false }, null] }
  assert.equal(issuesOf(() => A.issuerInput(badIssuer)).length, 7)
  assert.deepEqual(issuesOf(() => A.issuerInput(badIssuer)), schemaIssues(S.IssuerInput, badIssuer))
})

void test("page query preserves the decimal grammar, omission and duplicate rejection", () => {
  assert.equal(A.pageRequest(new URLSearchParams()), undefined)
  assert.equal(A.pageRequest(new URLSearchParams("unrelated=x")), undefined)
  for (const limit of ["0", "1", "200", "000010", "999999"]) {
    assert.deepEqual(A.pageRequest(new URLSearchParams({ limit })), { limit: Number(limit) })
    assert.deepEqual(Schema.decodeUnknownSync(S.PageQuery)({ limit }), { limit: Number(limit) })
    assert.deepEqual(Schema.decodeUnknownSync(S.ListQuery)({ limit }), { limit: Number(limit) })
  }
  assert.deepEqual(A.pageRequest(new URLSearchParams("cursor=")), { cursor: "" })
  for (const limit of ["", " 1", "1 ", "+1", "-1", "1.0", "1e2", "0x10", "NaN", "Infinity", "1234567", "١", "1\n"]) {
    assert.deepEqual(issuesOf(() => A.pageRequest(new URLSearchParams({ limit }))), schemaIssues(S.PageQuery, { limit }))
    schemaIssues(S.ListQuery, { limit })
  }
  for (const query of ["limit=1&limit=2", "cursor=a&cursor=b", "limit=&limit="]) {
    assert.deepEqual(issuesOf(() => A.pageRequest(new URLSearchParams(query))), ["limit and cursor must be supplied at most once"])
  }
})

void test("source query requires all three fields exactly once and maps them to the domain", () => {
  assert.equal(A.sourceFilter(new URLSearchParams()), undefined)
  assert.equal(A.sourceFilter(new URLSearchParams("limit=1")), undefined)
  const complete = { sourceApp: source.app, sourceKind: source.kind, sourceId: source.id }
  assert.deepEqual(A.sourceFilter(new URLSearchParams(complete)), source)
  assert.deepEqual(Schema.decodeUnknownSync(S.ListQuery)({ ...complete, limit: "10" }), { ...complete, limit: 10 })
  for (const key of Object.keys(complete)) {
    const partial = { ...complete }
    Reflect.deleteProperty(partial, key)
    assert.deepEqual(issuesOf(() => A.sourceFilter(new URLSearchParams(partial))), schemaIssues(S.SourceFilter, partial))
    schemaIssues(S.ListQuery, partial)
    const duplicate = new URLSearchParams(complete)
    duplicate.append(key, "duplicate")
    assert.deepEqual(issuesOf(() => A.sourceFilter(duplicate)), ["sourceApp, sourceKind, and sourceId must be supplied exactly once and together"])
  }
})

void test("Swagger exposes one buyer object plus notes and limit constraints", () => {
  const spec = OpenApi.fromApi(applicationHttpApi)
  for (const [path, method] of [["/api/drafts", "post"], ["/api/drafts/{id}", "put"], ["/api/invoices", "post"], ["/api/proformas", "post"]] as const) {
    const schema = spec.paths[path]?.[method]?.requestBody?.content["application/json"]?.schema as
      { type?: string, oneOf?: unknown, anyOf?: unknown, description?: string, properties?: Record<string, unknown> }
    assert.equal(schema.type, "object")
    assert.equal(schema.oneOf, undefined)
    assert.equal(schema.anyOf, undefined)
    assert.ok(schema.properties?.customerId)
    assert.ok(schema.properties.customer)
    assert.match(schema.description ?? "", /exactly one/i)
    assert.match(JSON.stringify(schema.properties.notes), /"maxLength":500/)
  }
  const limit = spec.paths["/api/customers"]?.get?.parameters.find((parameter) => parameter.name === "limit")
  assert.match(JSON.stringify(limit), /\\d\{1,6\}/)
})

void test("HTTP maps schema failures to the existing 400 envelope before domain operations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-http-input-"))
  const token = "a".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  try {
    applyMigrations(directory)
    const runtime = { dataDirectory: directory, authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000,
      dataDirectory: directory, nodeEnvironment: "test", authTokenFile: tokenFile, organizationId: "org-1" }) }
    const raw = { ...customer, name: 1, address: { ...customer.address, city: null } }
    const response = await handleApiRequest({ method: "POST", url: "/api/customers", authorization: `Bearer ${token}`, body: raw }, runtime)
    assert.deepEqual(response, { status: 400, body: { error: "ValidationFailure", issues: schemaIssues(S.CustomerInput, raw) } })
    for (const url of ["/api/drafts?sourceApp=shop", "/api/invoices?limit=1e2", "/api/proformas?limit=1&limit=2"]) {
      const result = await handleApiRequest({ method: "GET", url, authorization: `Bearer ${token}`, body: undefined }, runtime)
      assert.equal(result.status, 400)
      const body = result.body as { error: string, issues: unknown[] }
      assert.equal(body.error, "ValidationFailure")
      assert.ok(body.issues.length > 0 && body.issues.every((issue) => typeof issue === "string"))
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
