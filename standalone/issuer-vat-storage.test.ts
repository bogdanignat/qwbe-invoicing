import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createPdfRenderer } from "./pdf-renderer.ts"
import { createInvoiceSource } from "./sqlite-artifacts.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const each = { code: "C62", name: "unitate" } as const
let idempotency = 0
const request = <Input>(value: Input) => ({
  request: value,
  idempotency: { key: `issuer-vat-${String(++idempotency)}`, fingerprint: `sha256:${"0".repeat(64)}` },
})

void test("round-trips frozen issuer VAT status for invoices, proformas, conversions, and corrections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-issuer-vat-"))
  try {
    applyMigrations(directory)
    let now = new Date("2026-09-01T10:00:00.000Z")
    let nextId = 0
    const dependencies = {
      context: { current: Effect.succeed({
        identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
          "invoicing:read", "invoicing:settings.manage", "invoicing:customer.manage",
          "invoicing:invoice.draft", "invoicing:invoice.issue", "invoicing:invoice.void", "invoicing:proforma.issue",
        ] },
        organization: { id: "org-1" },
      }) },
      clock: { now: Effect.sync(() => now) },
      ids: { next: Effect.sync(() => `vat-id-${String(++nextId)}`) },
      branding: { normalize: () => Effect.die("branding normalization is not expected") },
      cubeIdentity: "invoicing",
    } as const
    const service = createInvoicingService({ ...dependencies, store: createSqliteStore(directory) })
    const issuer = {
      name: "Furnizor SRL", fiscalIdentifier: "RO12345674",
      address: { countryCode: "RO", city: "Iași", street: "Strada 1" }, legalForm: "srl" as const,
      tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
      socialCapital: "1000.00", defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
    }
    await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01" } }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const customer = await Effect.runPromise(service.createCustomer({ partyType: "company", name: "Client SRL",
      fiscalIdentifier: "RO87654329", address: { countryCode: "RO", city: "Cluj", street: "Strada 2" } }))
    const issueDraft = async (vatRateCode: string) => {
      const draft = await Effect.runPromise(service.createDraft({ customerId: customer.id, series: "INV", issueDate: now.toISOString().slice(0, 10) }))
      await Effect.runPromise(service.addDraftLine({ draftId: draft.id, description: "Servicii", quantity: "1",
        unitPrice: "100", unitOfMeasure: each, vatRateCode }))
      return draft
    }
    const registeredInvoice = await Effect.runPromise(service.issueInvoice(request({ draftId: (await issueDraft("RO_STANDARD")).id })))
    const registeredProforma = await Effect.runPromise(service.issueProforma(request({
      draftId: (await issueDraft("RO_STANDARD")).id, series: "PRO",
    })))
    const staleProforma = await Effect.runPromise(service.issueProforma(request({
      draftId: (await issueDraft("RO_STANDARD")).id, series: "PRO",
    })))
    const conversionRequest = request({ proformaId: registeredProforma.id, invoiceSeries: "INV" })
    const converted = await Effect.runPromise(service.issueInvoiceFromProforma(conversionRequest))
    assert.equal(registeredInvoice.issuer.vatRegistered, true)
    assert.equal(registeredProforma.issuer.vatRegistered, true)
    const renderer = createPdfRenderer()
    const source = createInvoiceSource(directory)
    const before = await Effect.runPromise(source.findInvoice("org-1", registeredInvoice.id))
    assert.ok(before)
    const originalPdf = await Effect.runPromise(renderer.render(before))

    now = new Date("2026-09-02T10:00:00.000Z")
    await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
      vatChange: { registered: false, effectiveFrom: "2026-09-02" } }))
    const profile = await Effect.runPromise(service.getIssuer())
    assert.equal("vatRegistered" in profile, false)
    const nonVatInvoice = await Effect.runPromise(service.issueInvoice(request({ draftId: (await issueDraft("RO_NON_VAT")).id })))
    const nonVatProforma = await Effect.runPromise(service.issueProforma(request({
      draftId: (await issueDraft("RO_NON_VAT")).id, series: "PRO",
    })))
    const conversionState = () => {
      const database = new DatabaseSync(databasePath(directory))
      try {
        return ["issued_invoices", "proforma_invoice_conversions", "idempotency_records", "audit_events", "invoice_sequences"]
          .map((table) => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
      } finally { database.close() }
    }
    const beforeRejection = conversionState()
    const rejected = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(
      request({ proformaId: staleProforma.id, invoiceSeries: "INV" }),
    )))
    assert.equal(rejected._tag, "Left")
    assert.equal(rejected.left._tag, "ValidationFailure")
    assert.deepEqual(conversionState(), beforeRejection)
    assert.equal((await Effect.runPromise(service.getProforma(staleProforma.id))).convertedInvoiceId, null)
    const correction = await Effect.runPromise(service.createCorrection(request({
      originalInvoiceId: registeredInvoice.id, reason: "Corecție fiscală",
    })))

    const restarted = createInvoicingService({ ...dependencies, store: createSqliteStore(directory) })
    const beforeReplay = conversionState()
    assert.deepEqual(await Effect.runPromise(restarted.issueInvoiceFromProforma(conversionRequest)), converted)
    assert.deepEqual(conversionState(), beforeReplay)
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(registeredInvoice.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getProforma(registeredProforma.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(converted.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getCorrection(correction.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(nonVatInvoice.id))).issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.getProforma(nonVatProforma.id))).issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.listIssuedInvoices())).items.find(({ id }) => id === nonVatInvoice.id)?.issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.listProformas())).items.find(({ id }) => id === nonVatProforma.id)?.issuer.vatRegistered, false)
    const unchanged = await Effect.runPromise(source.findInvoice("org-1", registeredInvoice.id))
    assert.ok(unchanged)
    assert.equal(unchanged.issuer.vatRegistered, true)
    assert.deepEqual((await Effect.runPromise(renderer.render(unchanged))).bytes, originalPdf.bytes)
    assert.equal((await Effect.runPromise(source.findProforma("org-1", nonVatProforma.id)))?.issuer.vatRegistered, false)

    const database = new DatabaseSync(databasePath(directory))
    try {
      assert.equal(database.prepare("SELECT issuer_vat_registered FROM issued_invoices WHERE id=?").get(nonVatInvoice.id)?.issuer_vat_registered, 0)
      assert.throws(() => database.prepare("UPDATE issued_invoices SET issuer_vat_registered=1 WHERE id=?").run(nonVatInvoice.id))
      assert.throws(() => database.prepare("UPDATE proformas SET issuer_vat_registered=1 WHERE id=?").run(nonVatProforma.id))
      assert.throws(() => database.prepare("UPDATE correction_documents SET issuer_vat_registered=0 WHERE id=?").run(correction.id))
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
