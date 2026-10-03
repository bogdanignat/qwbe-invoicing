import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../cube/invoicing/index.ts"
import { createPdfRenderer } from "../documents/pdf-renderer.ts"
import { createPostgresInvoiceSource } from "./postgres-artifacts.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * The frozen issuer VAT status, on PostgreSQL 16. Two mechanical changes: the
 * state snapshot orders rows by their own JSON instead of by `rowid`, which
 * PostgreSQL does not have, and the immutability probes assert the trigger's
 * SQLSTATE (`23514`) and its message — the triggers raise the SQLite text
 * verbatim, so the message is still part of the contract.
 */

const each = { code: "C62", name: "unitate" } as const
let idempotency = 0
const request = <Input>(value: Input) => ({
  request: value,
  idempotency: { key: `issuer-vat-${String(++idempotency)}`, fingerprint: `sha256:${"0".repeat(64)}` },
})

void test("round-trips frozen issuer VAT status for invoices, proformas, conversions, and corrections", async () => {
  await withMigrated("issuer_vat", async ({ pool, sql }) => {
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
    const service = createInvoicingService({ ...dependencies, store: createPostgresStore(pool) })
    const issuer = {
      name: "Furnizor SRL", fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl" as const,
      tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
      socialCapital: "1000.00", defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
    }
    await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01" } }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const customer = await Effect.runPromise(service.createCustomer({ partyType: "company", name: "Client SRL",
      fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Cluj", street: "Strada 2", county: "RO-CJ" } }))
    const issueDraft = async (vatRateCode: string) => {
      const draft = await Effect.runPromise(service.createDraft(request({ customerId: customer.id, series: "INV",
        issueDate: now.toISOString().slice(0, 10), dueDate: "2026-09-30" })))
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
    const source = createPostgresInvoiceSource(pool)
    const before = await Effect.runPromise(source.findInvoice("org-1", registeredInvoice.id))
    assert.ok(before)
    const originalPdf = await Effect.runPromise(renderer.render(before))

    now = new Date("2026-09-02T10:00:00.000Z")
    await Effect.runPromise(service.configureIssuer({ ...issuer, fiscalIdentifier: "12345674",
      vatChange: { registered: false, nonVatBasis: "article_310", effectiveFrom: "2026-09-02" } }))
    const profile = await Effect.runPromise(service.getIssuer())
    assert.equal("vatRegistered" in profile, false)
    const nonVatInvoice = await Effect.runPromise(service.issueInvoice(request({ draftId: (await issueDraft("RO_NON_VAT")).id })))
    const nonVatProforma = await Effect.runPromise(service.issueProforma(request({
      draftId: (await issueDraft("RO_NON_VAT")).id, series: "PRO",
    })))
    const nonVatCorrection = await Effect.runPromise(service.createCorrection(request({
      originalInvoiceId: nonVatInvoice.id, reason: "Corecție regim art. 310",
    })))
    // Each row as its own JSON, ordered by that JSON: a total order that needs no
    // per-table key and compares byte for byte, where SQLite leaned on `rowid`.
    const rowsOf = (client: RawSql, table: string) =>
      client.query<{ readonly row: unknown }>(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
    const conversionState = async () => await Promise.all(
      ["issued_invoices", "proforma_invoice_conversions", "idempotency_records", "audit_events", "invoice_sequences"]
        .map((table) => rowsOf(sql, table)),
    )
    const beforeRejection = await conversionState()
    const rejected = await Effect.runPromise(Effect.either(service.issueInvoiceFromProforma(
      request({ proformaId: staleProforma.id, invoiceSeries: "INV" }),
    )))
    assert.equal(rejected._tag, "Left")
    assert.equal(rejected.left._tag, "ValidationFailure")
    assert.deepEqual(await conversionState(), beforeRejection)
    assert.equal((await Effect.runPromise(service.getProforma(staleProforma.id))).convertedInvoiceId, null)
    const correction = await Effect.runPromise(service.createCorrection(request({
      originalInvoiceId: registeredInvoice.id, reason: "Corecție fiscală",
    })))

    const restarted = createInvoicingService({ ...dependencies, store: createPostgresStore(pool) })
    const beforeReplay = await conversionState()
    assert.deepEqual(await Effect.runPromise(restarted.issueInvoiceFromProforma(conversionRequest)), converted)
    assert.deepEqual(await conversionState(), beforeReplay)
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(registeredInvoice.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getProforma(registeredProforma.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(converted.id))).issuer.vatRegistered, true)
    assert.equal((await Effect.runPromise(restarted.getCorrection(correction.id))).issuer.vatRegistered, true)
    assert.deepEqual((await Effect.runPromise(restarted.getCorrection(nonVatCorrection.id))).lines[0], nonVatCorrection.lines[0])
    assert.deepEqual((await Effect.runPromise(restarted.getCorrection(nonVatCorrection.id))).vatBreakdown[0], nonVatCorrection.vatBreakdown[0])
    assert.equal((await Effect.runPromise(restarted.getIssuedInvoice(nonVatInvoice.id))).issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.getProforma(nonVatProforma.id))).issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.listIssuedInvoices())).items.find(({ id }) => id === nonVatInvoice.id)?.issuer.vatRegistered, false)
    assert.equal((await Effect.runPromise(restarted.listProformas())).items.find(({ id }) => id === nonVatProforma.id)?.issuer.vatRegistered, false)
    const unchanged = await Effect.runPromise(source.findInvoice("org-1", registeredInvoice.id))
    assert.ok(unchanged)
    assert.equal(unchanged.issuer.vatRegistered, true)
    assert.deepEqual((await Effect.runPromise(renderer.render(unchanged))).bytes, originalPdf.bytes)
    assert.equal((await Effect.runPromise(source.findProforma("org-1", nonVatProforma.id)))?.issuer.vatRegistered, false)

    assert.deepEqual(await sql.one(`SELECT code,rate,category,vat_exemption_reason
      FROM issuer_tax_configurations WHERE organization_id=$1 AND code='RO_NON_VAT'`, ["org-1"]), {
      code: "RO_NON_VAT", rate: "0.00", category: "O",
      vat_exemption_reason: "Regim special de scutire conform art. 310 din Codul fiscal",
    })
    for (const [table, parentColumn, parentId, categoryColumn, rateColumn] of [
      ["draft_lines", "draft_id", nonVatInvoice.draftId, "tax_category", "tax_rate"],
      ["issued_lines", "invoice_id", nonVatInvoice.id, "tax_category", "tax_rate"],
      ["issued_tax_breakdown", "invoice_id", nonVatInvoice.id, "category", "rate"],
      ["proforma_lines", "proforma_id", nonVatProforma.id, "tax_category", "tax_rate"],
      ["proforma_tax_breakdown", "proforma_id", nonVatProforma.id, "category", "rate"],
      ["correction_lines", "correction_id", nonVatCorrection.id, "tax_category", "tax_rate"],
      ["correction_tax_breakdown", "correction_id", nonVatCorrection.id, "category", "rate"],
    ] as const) {
      assert.deepEqual(await sql.one(`SELECT tax_code,${categoryColumn} AS category,${rateColumn} AS rate,
        vat_exemption_reason FROM ${table} WHERE ${parentColumn}=$1`, [parentId]), {
        tax_code: "RO_NON_VAT", category: "O", rate: "0.00",
        vat_exemption_reason: "Regim special de scutire conform art. 310 din Codul fiscal",
      }, table)
    }
    // The non-VAT basis is a profile fact and is never frozen into a document.
    assert.deepEqual(await sql.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'non_vat_basis'
         AND table_name IN ('issuer_tax_configurations','draft_lines','issued_lines','issued_tax_breakdown',
           'proforma_lines','proforma_tax_breakdown','correction_lines','correction_tax_breakdown')`,
    ), [])
    assert.equal(await sql.scalar("SELECT issuer_vat_registered FROM issued_invoices WHERE id=$1", [nonVatInvoice.id]), 0)
    for (const [statement, parameter, message] of [
      ["UPDATE issued_invoices SET issuer_vat_registered=1 WHERE id=$1", nonVatInvoice.id, /issued invoices are immutable/u],
      ["UPDATE proformas SET issuer_vat_registered=1 WHERE id=$1", nonVatProforma.id, /proforma/u],
      ["UPDATE correction_documents SET issuer_vat_registered=0 WHERE id=$1", correction.id, /correction/u],
      ["UPDATE correction_lines SET vat_exemption_reason=NULL WHERE correction_id=$1", nonVatCorrection.id, /correction/u],
      ["UPDATE correction_tax_breakdown SET category='S' WHERE correction_id=$1", nonVatCorrection.id, /correction/u],
    ] as const) {
      const failure = await sql.rejects(statement, [parameter])
      assert.equal(failure.code, "23514", statement)
      assert.match(failure.message, message, statement)
    }
  })
})
