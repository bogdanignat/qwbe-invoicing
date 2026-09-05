import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { contextProvider, each, emptyState, expectConflict, fixedClock, identity, idempotent, memoryStore, sequentialIds, vatConfigurations } from "../../application/memory-store.test-support.ts"
import { PermissionDenied, ResourceNotFound, ValidationFailure } from "../../contracts/index.ts"

void test("corrects an issued invoice exactly once with a negated immutable snapshot", async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations,
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  const customer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" } }
  const invoice = await Effect.runPromise(service.issueInvoice(idempotent({
    customer, series: "QWBE", issueDate: "2026-09-01", currency: "RON" as const,
    source: { app: "shop", kind: "order", id: "order-7" },
    lines: [{ description: "Servicii", quantity: "1.2500", unitPrice: "100.00", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
  })))

  const missing = await Effect.runPromise(Effect.flip(service.createCorrection(idempotent({ originalInvoiceId: "nope", reason: "Storno" }))))
  assert.equal(missing instanceof ResourceNotFound && missing.resource === "invoice", true)

  const before = await Effect.runPromise(Effect.flip(service.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Storno", issueDate: "2026-08-31" }))))
  assert.equal(before instanceof ValidationFailure && before.issues.includes("issueDate cannot be before the original invoice issueDate"), true)
  const future = await Effect.runPromise(Effect.flip(service.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Storno", issueDate: "2026-09-02" }))))
  assert.equal(future instanceof ValidationFailure && future.issues.includes("issueDate cannot be in the future"), true)

  const attempt = idempotent({ originalInvoiceId: invoice.id, reason: "  Eroare de cantitate  " })
  const correction = await Effect.runPromise(service.createCorrection(attempt))
  assert.equal(correction.originalInvoiceId, invoice.id)
  assert.equal(correction.series, "QWBE")
  assert.equal(correction.number, 2)
  assert.equal(correction.fiscalYear, 2026)
  assert.equal(correction.issueDate, "2026-09-01")
  assert.equal(correction.reason, "Eroare de cantitate")
  assert.deepEqual(correction.source, { app: "shop", kind: "order", id: "order-7" })
  assert.equal(correction.totalExcludingVat, "-125.00")
  assert.equal(correction.vatTotal, "-26.25")
  assert.equal(correction.totalIncludingVat, "-151.25")
  assert.equal(correction.lines[0]?.totalIncludingVat, "-151.25")
  assert.deepEqual(correction.vatBreakdown, [{ code: "RO_STANDARD", rate: "21.00", vatBaseAmount: "-125.00", vatAmount: "-26.25" }])
  assert.deepEqual(correction.issuer, invoice.issuer)
  assert.deepEqual(correction.customer, invoice.customer)
  assert.equal(state.sequences.get("org-1:2026:invoice:QWBE"), 2)
  assert.equal(state.sequences.get("org-1:2026:correction:QWBE"), undefined)

  const replay = await Effect.runPromise(service.createCorrection(attempt))
  assert.deepEqual(replay, correction)
  await expectConflict(service.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Din nou" })), "invoice_already_corrected")
  assert.deepEqual(await Effect.runPromise(service.getCorrection(correction.id)), correction)
  assert.deepEqual(await Effect.runPromise(service.listCorrections(invoice.id)), [correction])
  assert.deepEqual(await Effect.runPromise(service.listCorrections(invoice.id, { app: "shop", kind: "order", id: "order-7" })), [correction])
  assert.deepEqual(await Effect.runPromise(service.listCorrections(invoice.id, { app: "shop", kind: "order", id: "other" })), [])

  const other = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-2" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  assert.equal(await Effect.runPromise(Effect.flip(other.getCorrection(correction.id))) instanceof ResourceNotFound, true)
  const denied = createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions: identity.permissions.filter((p) => p !== "invoicing:invoice.void") }, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), cubeIdentity: "invoicing",
  })
  assert.equal(await Effect.runPromise(Effect.flip(denied.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Storno" })))) instanceof PermissionDenied, true)
})
