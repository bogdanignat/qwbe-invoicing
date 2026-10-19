import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { PermissionDenied, ValidationFailure } from "../../contracts/index.ts"

const serviceFor = (state: ReturnType<typeof emptyState>, permissions = identity.permissions, organizationId = "org-1") => createInvoicingService({
  context: contextProvider({ identity: { ...identity, permissions }, organization: { id: organizationId } }),
  clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
})

void test("revenue nets invoices and their corrections by issue month, for one organization", async () => {
  const state = emptyState()
  const service = serviceFor(state)
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  const customer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" } }
  const issue = (issueDate: string, unitPrice: string) => Effect.runPromise(service.issueInvoice(idempotent({
    customer, series: "QWBE", issueDate, dueDate: issueDate, currency: "RON" as const,
    lines: [{ description: "Servicii", quantity: "1", unitPrice, unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
  })))
  const july = await issue("2026-07-10", "100.00")
  await issue("2026-08-20", "200.00")
  await Effect.runPromise(service.createCorrection(idempotent({ originalInvoiceId: july.id, reason: "Storno", issueDate: "2026-09-01" })))

  const report = await Effect.runPromise(service.getRevenueReport({ from: "2026-08-01", to: "2026-09-30" }))
  assert.deepEqual(report, {
    from: "2026-08-01", to: "2026-09-30", currency: "RON",
    months: [
      { month: "2026-08", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 0 },
      { month: "2026-09", revenueExcludingVat: "-100.00", invoicedIncludingVat: "-121.00", invoiceCount: 0, correctionCount: 1 },
    ],
    totals: { revenueExcludingVat: "100.00", invoicedIncludingVat: "121.00", invoiceCount: 1, correctionCount: 1 },
  })
  const other = await Effect.runPromise(serviceFor(state, identity.permissions, "org-2").getRevenueReport({ from: "2026-07-01", to: "2026-09-30" }))
  assert.deepEqual(other.totals, { revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 })
  assert.equal(other.months.length, 3)

  const invalid = await Effect.runPromise(Effect.flip(service.getRevenueReport({ from: "2026-02-30", to: "2026-09-30" })))
  assert.equal(invalid instanceof ValidationFailure && invalid.issues[0], "from must be a calendar date in YYYY-MM-DD format")
  const denied = await Effect.runPromise(Effect.flip(serviceFor(state, identity.permissions.filter((name) => name !== "invoicing:read"))
    .getRevenueReport({ from: "2026-08-01", to: "2026-09-30" })))
  assert.equal(denied instanceof PermissionDenied, true)
})
