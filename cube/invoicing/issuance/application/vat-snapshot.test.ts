import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"

void test("SRL and PFA freeze VAT registration at issueDate on direct and draft invoice/proforma issuance", async () => {
  for (const legalForm of ["srl", "pfa"] as const) {
    const state = emptyState()
    const service = createInvoicingService({ context: contextProvider({ identity, organization: { id: "org-1" } }),
      clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing" })
    const issuer = { name: "Emitent", fiscalIdentifier: "12345674", legalForm,
      tradeRegistryNumber: legalForm === "srl" ? "J40/123/2020" : "F40/123/2020",
      socialCapital: legalForm === "srl" ? "200.00" : "", iban: "", bankName: "", branding: null,
      address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, defaultCurrency: "RON", defaultPaymentTermDays: 15 }
    await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: false, effectiveFrom: "2025-08-01" } }))
    await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
      vatChange: { registered: true, effectiveFrom: "2026-09-01" } }))
    assert.equal("vatRegistered" in (await Effect.runPromise(service.getIssuer())), false)
    for (const documentType of ["invoice", "proforma"] as const) {
      await Effect.runPromise(service.addDocumentSeries({ documentType, series: documentType === "invoice" ? "INV" : "PRO" }))
    }
    for (const issueDate of ["2026-08-31", "2026-09-01"]) {
      const registered = issueDate === "2026-09-01"
      const line = { description: "Serviciu", quantity: "1", unitPrice: "10", unitOfMeasure: each,
        vatRateCode: registered ? "RO_STANDARD" : "RO_NON_VAT" }
      const document = { series: "INV", issueDate, dueDate: issueDate, currency: "RON" as const, customer: { partyType: "individual" as const,
        name: "Client", fiscalIdentifier: "", vatRegistered: false, address: issuer.address }, lines: [line] }
      const invoice = await Effect.runPromise(service.issueInvoice(idempotent(document)))
      const proforma = await Effect.runPromise(service.issueProforma(idempotent({ ...document, proformaSeries: "PRO" })))
      assert.equal(invoice.issuer.vatRegistered, registered)
      assert.equal(proforma.issuer.vatRegistered, registered)
      for (const kind of ["invoice", "proforma"]) {
        const draft = await Effect.runPromise(service.createDraft(document))
        await Effect.runPromise(service.addDraftLine({ draftId: draft.id, ...line }))
        const issued = kind === "invoice"
          ? await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
          : await Effect.runPromise(service.issueProforma(idempotent({ draftId: draft.id, series: "PRO" })))
        assert.equal(issued.issuer.vatRegistered, registered)
      }
    }
  }
})
