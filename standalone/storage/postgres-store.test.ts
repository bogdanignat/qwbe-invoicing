import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict,
  ResourceNotFound,
  createInvoicingService,
  type Clock,
  type IdGenerator,
  type RequestContextProvider,
} from "../../cube/invoicing/index.ts"
import { PersistenceFailure as PaymentsPersistenceFailure, createPaymentsService } from "../../cube/payments/index.ts"
import { withEmpty, withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresPaymentsStore, createPostgresStore } from "./postgres-store.ts"

/**
 * The store suite on PostgreSQL 16. Everything the application does is
 * unchanged; what was ported is how the suite talks to the database behind the
 * application's back.
 *
 * `new DatabaseSync(databasePath(directory))` has no counterpart here, and does
 * not need one: the probes that forged or tampered with rows now go through the
 * rig's parameterised helper, with `$N` instead of `?`, and each refusal is
 * asserted by SQLSTATE — `23514`, which is what the shared foundation trigger
 * function raises — instead of by SQLite's `assert.throws` with no expectation
 * at all. A failed statement aborts a PostgreSQL transaction, so the helper runs
 * every probe in autocommit; twenty refusals in a row behave as they did.
 *
 * "Store recreation" is also no longer "reopen the file": the pool is the
 * process-wide resource, so a restarted service is a second store over the same
 * pool, which is exactly what a restarted process gets.
 */

const permissions = [
  "invoicing:read",
  "invoicing:customer.manage",
  "invoicing:invoice.draft",
  "invoicing:invoice.issue",
  "invoicing:proforma.issue",
  "invoicing:invoice.void",
  "invoicing:settings.manage",
  "payments:read",
  "payments:payment.record",
]

const context = (organizationId: string): RequestContextProvider => ({
  current: Effect.succeed({
    identity: { id: "user-1", username: "owner", roles: ["admin"], permissions },
    organization: { id: organizationId },
  }),
})

const clock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }
const each = { code: "C62", name: "unitate" } as const
const branding = { normalize: () => Effect.succeed({ pngBase64: "iVBORw0KGgo=", width: 12, height: 6 }) }
const summaryOf = <Document extends { readonly issuer: { readonly branding: unknown } }>(document: Document) => {
  const issuer = { ...document.issuer }
  delete issuer.branding
  return { ...document, issuer }
}
let idempotencyCounter = 0
const idempotent = <Input>(request: Input) => ({
  request,
  idempotency: { key: `store-${String(++idempotencyCounter)}`, fingerprint: `sha256:${"0".repeat(64)}` },
})

const ids = (): IdGenerator => {
  let value = 0
  return { next: Effect.sync(() => `persistent-${String(++value)}`) }
}

/**
 * A write the schema has to refuse, with the SQLSTATE that refused it. `23514`
 * covers both a CHECK and the foundation trigger function, which raises
 * `check_violation` with the message the SQLite triggers used verbatim.
 */
const refuses = async (sql: RawSql, statement: string, values: ReadonlyArray<unknown> = [], code = "23514") => {
  const failure = await sql.rejects(statement, values)
  assert.equal(failure.code, code, statement)
}

void test("persists an issued snapshot across store recreation and isolates organizations", async () => {
  await withMigrated("store_persist", async ({ pool, sql }) => {
    const idGenerator = ids()
    const service = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: idGenerator,
      store: createPostgresStore(pool),
      branding,
      cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer({
      name: "Exemplu SRL",
      fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "București", street: "Strada Mare 1", county: "RO-B", sector: 2, postalCode: "020000" },
      legalForm: "srl",
      tradeRegistryNumber: "J22/123/2020",
      iban: "RO49AAAA1B31007593840000",
      bankName: "Banca Română",
      socialCapital: "1000.00",
      defaultCurrency: "RON",
      defaultPaymentTermDays: 15,
      vatChange: { registered: true, effectiveFrom: "2025-08-01" },
      branding: { text: "  Marca A  ", image: { dataBase64: "iVBORw0KGgo=" } },
    }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "ALT" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const duplicate = await Effect.runPromise(Effect.flip(
      service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }),
    ))
    assert.equal(duplicate instanceof DomainConflict && duplicate.code === "document_series_exists", true)
    const customer = await Effect.runPromise(service.createCustomer({
      partyType: "company",
      name: "Client SRL",
      fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "București", street: "Strada Mică 2", county: "RO-B", sector: 3 },
      defaultPaymentTermDays: 14,
    }))
    const updatedCustomer = await Effect.runPromise(service.updateCustomer({
      id: customer.id, partyType: "company", name: "Client Actualizat SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "București", street: "Strada Nouă 3", county: "RO-B", sector: 4 }, defaultPaymentTermDays: 30,
    }))
    assert.equal(updatedCustomer.defaultPaymentTermDays, 30)
    const preset = await Effect.runPromise(service.createProductPreset({ description: "  Servicii software  ", unitPrice: "125.5", unitOfMeasure: each }))
    assert.equal(preset.unitPrice, "125.50")
    assert.deepEqual(await Effect.runPromise(service.listProductPresets()), { items: [preset], nextCursor: null })
    const draft = await Effect.runPromise(service.createDraft(idempotent({
      customerId: customer.id,
      issueDate: "2026-09-01",
      dueDate: "2026-09-16",
      series: "QWBE",
      source: { app: "crm", kind: "contract", id: "contract-1" },
    })))
    // An open draft keeps the series it was created with, even for another
    // series of the same document type.
    await refuses(sql, "UPDATE invoice_drafts SET series = 'PRO' WHERE id = $1", [draft.id])
    await refuses(sql, "UPDATE invoice_drafts SET series = 'ALT' WHERE id = $1", [draft.id])
    const openDraftDeletion = await Effect.runPromise(Effect.flip(service.deleteCustomer(customer.id)))
    assert.equal(openDraftDeletion instanceof DomainConflict && openDraftDeletion.code === "customer_has_open_drafts", true)
    await Effect.runPromise(service.addDraftLine({
      draftId: draft.id,
      description: "Servicii software",
      quantity: "1.25",
      unitPrice: "100.00",
      unitOfMeasure: each,
      vatRateCode: "RO_STANDARD",
    }))
    const issued = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
    assert.equal(issued.actorId, "user-1")
    const paymentService = createPaymentsService({
      context: context("org-1"), clock, ids: idGenerator, store: createPostgresPaymentsStore(pool), cubeIdentity: "payments",
    })
    const paymentAttempt = idempotent({ invoiceId: issued.id, amount: "25", currency: "RON", paymentDate: "2026-09-01", method: "transfer" })
    const payment = await Effect.runPromise(paymentService.recordPayment(paymentAttempt))
    assert.equal(payment.payment.actorId, "user-1")
    assert.deepEqual(await Effect.runPromise(paymentService.recordPayment(paymentAttempt)), payment)
    assert.deepEqual(issued.issuer.branding, {
      text: "Marca A", image: { pngBase64: "iVBORw0KGgo=", width: 12, height: 6 },
    })
    const proformaSource = await Effect.runPromise(service.createDraft(idempotent({
      customerId: customer.id, issueDate: "2026-09-01", dueDate: "2026-09-16", series: "QWBE",
      source: { app: "crm", kind: "offer", id: "offer-1" },
    })))
    const proformaAuthored = await Effect.runPromise(service.addDraftLine({
      draftId: proformaSource.id, description: "Avans", quantity: "1", unitPrice: "50", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
    }))
    const proforma = await Effect.runPromise(service.issueProforma(idempotent({ draftId: proformaSource.id, series: "PRO" })))
    assert.equal(proforma.actorId, "user-1")
    assert.equal(proforma.convertedDraftId, null)
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedDraftId, null)
    assert.equal((await Effect.runPromise(service.listProformas())).items[0]?.convertedDraftId, null)
    const converted = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "QWBE" })))
    assert.deepEqual(converted.lines, proformaAuthored.lines)
    assert.equal(converted.series, "QWBE")
    assert.equal(converted.dueDate, "2026-09-16")
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedInvoiceId, converted.id)
    const duplicateConversion = await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma(idempotent({ proformaId: proforma.id, invoiceSeries: "QWBE" }))))
    assert.equal(duplicateConversion instanceof DomainConflict && duplicateConversion.code === "proforma_already_converted", true)
    const directProforma = await Effect.runPromise(service.issueProforma(idempotent({ customerId: customer.id,
      proformaSeries: "PRO", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON",
      lines: [{ description: "Direct", quantity: "1", unitPrice: "75", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] })))
    const directInvoice = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({ proformaId: directProforma.id, invoiceSeries: "QWBE" })))
    assert.equal(directInvoice.sourceProformaId, directProforma.id)
    assert.deepEqual(directInvoice.lines, directProforma.lines)
    assert.equal((await Effect.runPromise(service.getProforma(directProforma.id))).convertedInvoiceId, directInvoice.id)
    const duplicateDirect = await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma(idempotent({ proformaId: directProforma.id, invoiceSeries: "QWBE" }))))
    assert.equal(duplicateDirect instanceof DomainConflict && duplicateDirect.code === "proforma_already_converted", true)
    const correction = await Effect.runPromise(service.createCorrection(idempotent({
      originalInvoiceId: issued.id, reason: "Corecție fiscală",
    })))
    assert.equal(correction.actorId, "user-1")

    // A restarted process: a second store over the same pool, reading only what
    // the database holds.
    const restarted = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: idGenerator,
      store: createPostgresStore(pool),
      branding,
      cubeIdentity: "invoicing",
    })
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)
    assert.deepEqual((await Effect.runPromise(restarted.getIssuer())).branding, issued.issuer.branding)
    assert.equal(JSON.stringify(await Effect.runPromise(restarted.listIssuedInvoices())).includes("pngBase64"), false)
    assert.equal(JSON.stringify(await Effect.runPromise(restarted.listProformas())).includes("pngBase64"), false)
    assert.deepEqual(await Effect.runPromise(restarted.listIssuedInvoices({ app: "crm", kind: "contract", id: "contract-1" })), { items: [summaryOf(issued)], nextCursor: null })
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(directInvoice.id)), directInvoice)
    assert.deepEqual(await Effect.runPromise(restarted.getProforma(proforma.id)), { ...proforma, convertedInvoiceId: converted.id })
    assert.deepEqual((await Effect.runPromise(restarted.listProformas())).items.find(({ id }) => id === proforma.id),
      summaryOf({ ...proforma, convertedInvoiceId: converted.id }))
    assert.deepEqual(await Effect.runPromise(restarted.listProformas({ app: "crm", kind: "offer", id: "offer-1" })),
      { items: [summaryOf({ ...proforma, convertedInvoiceId: converted.id })], nextCursor: null })
    assert.equal((await Effect.runPromise(restarted.getDraft(proformaSource.id))).status, "proforma_issued")
    assert.equal((await Effect.runPromise(restarted.getCustomer(customer.id))).defaultPaymentTermDays, 30)
    assert.deepEqual(await Effect.runPromise(restarted.listProductPresets()), { items: [preset], nextCursor: null })
    const persistedDraft = await Effect.runPromise(restarted.getDraft(draft.id))
    assert.equal(persistedDraft.series, "QWBE")
    assert.equal(persistedDraft.customer.partyType, "company")
    assert.equal(persistedDraft.totalIncludingVat, "151.25")
    assert.deepEqual(await Effect.runPromise(restarted.listDocumentSeries()), [
      { organizationId: "org-1", documentType: "invoice", series: "ALT" },
      { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
      { organizationId: "org-1", documentType: "proforma", series: "PRO" },
    ])

    await Effect.runPromise(restarted.deleteCustomer(customer.id))
    assert.deepEqual(await Effect.runPromise(restarted.listCustomers()), { items: [], nextCursor: null })
    const deletedCustomer = await Effect.runPromise(Effect.flip(restarted.getCustomer(customer.id)))
    assert.equal(deletedCustomer instanceof ResourceNotFound, true)
    assert.equal(await Effect.runPromise(Effect.flip(restarted.updateCustomer(updatedCustomer))) instanceof ResourceNotFound, true)
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    for (const [statement, values] of [
      ["UPDATE issued_lines SET description = $1 WHERE invoice_id = $2", ["tampered", issued.id]],
      ["UPDATE issued_tax_breakdown SET tax_amount = $1 WHERE invoice_id = $2", ["0.00", issued.id]],
      ["UPDATE issued_invoices SET total_including_tax = $1 WHERE id = $2", ["0.00", issued.id]],
      ["UPDATE issued_invoices SET issuer_county = $1 WHERE id = $2", ["RO-BT", issued.id]],
      ["UPDATE issued_invoices SET issuer_sector = 1 WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET customer_sector = 1 WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET customer_vat_registered = 0 WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET issuer_postal_code = NULL WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET source_id = 'changed' WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET issuer_branding = NULL WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET issuer_iban = '' WHERE id = $1", [issued.id]],
      ["UPDATE issued_invoices SET actor_id = 'other' WHERE id = $1", [issued.id]],
      ["UPDATE proformas SET actor_id = 'other' WHERE id = $1", [proforma.id]],
      ["UPDATE correction_documents SET actor_id = 'other' WHERE id = $1", [correction.id]],
    ] as ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>) {
      await refuses(sql, statement, values)
    }
    const trail = await sql.query<{ readonly actor_id: string; readonly action: string; readonly target_kind: string; readonly target_id: string }>(
      "SELECT actor_id,action,target_kind,target_id FROM audit_events WHERE organization_id=$1 ORDER BY occurred_at,id", ["org-1"],
    )
    assert.ok(trail.some((event) => event.actor_id === "user-1" && event.action === "invoice.issued"
      && event.target_kind === "invoice" && event.target_id === issued.id))
    assert.ok(trail.some((event) => event.actor_id === "user-1" && event.action === "proforma.issued"
      && event.target_kind === "proforma" && event.target_id === proforma.id))
    assert.ok(trail.some((event) => event.actor_id === "user-1" && event.action === "payment.recorded"
      && event.target_kind === "payment" && event.target_id === payment.payment.id))
    assert.ok(trail.some((event) => event.actor_id === "user-1" && event.action === "correction.created"
      && event.target_kind === "correction" && event.target_id === correction.id))
    for (const [statement, values] of [
      ["UPDATE audit_events SET actor_id='other' WHERE organization_id=$1", ["org-1"]],
      ["DELETE FROM audit_events WHERE organization_id=$1", ["org-1"]],
      ["DELETE FROM issued_lines WHERE invoice_id = $1", [issued.id]],
      ["DELETE FROM issued_tax_breakdown WHERE invoice_id = $1", [issued.id]],
      ["DELETE FROM issued_invoices WHERE id = $1", [issued.id]],
      ["DELETE FROM invoice_drafts WHERE id = $1", [draft.id]],
      ["UPDATE proformas SET total_including_tax='0.00' WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET source_id='changed' WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET issuer_branding=NULL WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET issuer_social_capital='0.00' WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET issuer_sector=1 WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET customer_sector=1 WHERE id=$1", [proforma.id]],
      ["UPDATE proformas SET customer_vat_registered=0 WHERE id=$1", [proforma.id]],
      ["UPDATE correction_documents SET issuer_sector=1 WHERE id=$1", [correction.id]],
      ["UPDATE correction_documents SET customer_sector=1 WHERE id=$1", [correction.id]],
      ["UPDATE correction_documents SET customer_vat_registered=0 WHERE id=$1", [correction.id]],
      ["UPDATE issuers SET branding='not-json' WHERE organization_id='org-1'", []],
    ] as ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>) {
      await refuses(sql, statement, values)
    }
    assert.equal(await sql.scalar("SELECT sealed FROM proformas WHERE id=$1", [proforma.id]), 1)
    assert.equal(await sql.scalar("SELECT actor_id FROM proforma_invoice_conversions WHERE proforma_id=$1", [proforma.id]), "user-1")
    await refuses(sql, `INSERT INTO proforma_lines(
      id,proforma_id,organization_id,line_position,description,quantity,unit_price,tax_code,tax_category,
      tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,unit_name)
      SELECT 'late-line',proforma_id,organization_id,line_position+10,description,quantity,unit_price,tax_code,tax_category,
      tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,unit_name FROM proforma_lines WHERE proforma_id=$1 LIMIT 1`, [proforma.id])
    await refuses(sql, `INSERT INTO proforma_tax_breakdown
      SELECT proforma_id,organization_id,line_position+10,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount
      FROM proforma_tax_breakdown WHERE proforma_id=$1 LIMIT 1`, [proforma.id])
    await refuses(sql, "DELETE FROM proforma_lines WHERE proforma_id=$1", [proforma.id])
    await refuses(sql, "DELETE FROM proforma_tax_breakdown WHERE proforma_id=$1", [proforma.id])
    await refuses(sql, "DELETE FROM proforma_invoice_conversions WHERE proforma_id=$1", [proforma.id])
    await sql.query(`INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,
      customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
      series,issue_date,due_date,currency,status) SELECT 'wrong-series-source',organization_id,NULL,customer_party_type,
      customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
      customer_sector,customer_postal_code,customer_vat_registered,series,issue_date,due_date,currency,'proforma_issued' FROM invoice_drafts WHERE id=$1`, [proformaSource.id])
    // Neither an invoice series nor an undeclared one can be worn by a proforma:
    // the composite key (organization_id, document_type, series) into
    // `document_series` refuses both, with `23503`. SQLite accepted these two
    // inserts as far as the schema was concerned and the legacy suite only saw an
    // error because it also listed an `invoice_series` column, which no schema
    // has ever had.
    await refuses(sql, `INSERT INTO proformas(id,source_draft_id,organization_id,fiscal_year,document_type,
      series,number,issue_date,due_date,issued_at,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,
      issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,issuer_legal_form,issuer_trade_registry_number,
      issuer_iban,issuer_bank_name,issuer_social_capital,customer_party_type,customer_legal_name,
      customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
      total_excluding_tax,tax_total,total_including_tax,sealed,actor_id,issuer_vat_registered)
      SELECT 'wrong-series-proforma','wrong-series-source',
      organization_id,fiscal_year,document_type,'QWBE',number+10,issue_date,due_date,issued_at,currency,issuer_legal_name,
       issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,issuer_legal_form,
      issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,customer_party_type,
       customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
       customer_sector,customer_postal_code,customer_vat_registered,total_excluding_tax,tax_total,total_including_tax,0,actor_id,issuer_vat_registered FROM proformas WHERE id=$1`, [proforma.id], "23503")
    await refuses(sql, `INSERT INTO proformas(id,source_draft_id,organization_id,fiscal_year,document_type,
      series,number,issue_date,due_date,issued_at,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,
      issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,issuer_legal_form,issuer_trade_registry_number,
      issuer_iban,issuer_bank_name,issuer_social_capital,customer_party_type,customer_legal_name,
      customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
      total_excluding_tax,tax_total,total_including_tax,sealed,actor_id,issuer_vat_registered)
      SELECT 'missing-series-proforma','wrong-series-source',
      organization_id,fiscal_year,document_type,'MISSING',number+11,issue_date,due_date,issued_at,currency,issuer_legal_name,
       issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,issuer_legal_form,
      issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,customer_party_type,
       customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
       customer_sector,customer_postal_code,customer_vat_registered,total_excluding_tax,tax_total,total_including_tax,0,actor_id,issuer_vat_registered FROM proformas WHERE id=$1`, [proforma.id], "23503")
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    const otherOrganization = createInvoicingService({
      context: context("org-2"),
      clock,
      ids: ids(),
      store: createPostgresStore(pool),
      branding,
      cubeIdentity: "invoicing",
    })
    const failure = await Effect.runPromise(Effect.flip(otherOrganization.getIssuedInvoice(issued.id)))
    assert.equal(failure instanceof ResourceNotFound, true)
    assert.equal(await Effect.runPromise(Effect.flip(otherOrganization.getIssuer())) instanceof ResourceNotFound, true)
    assert.equal(await Effect.runPromise(Effect.flip(otherOrganization.getProforma(proforma.id))) instanceof ResourceNotFound, true)
    assert.deepEqual(await Effect.runPromise(otherOrganization.listProductPresets()), { items: [], nextCursor: null })
    assert.equal(await Effect.runPromise(Effect.flip(otherOrganization.updateProductPreset({
      id: preset.id, description: "Intrus", unitPrice: "1.00", unitOfMeasure: each,
    }))) instanceof ResourceNotFound, true)
    assert.equal(await Effect.runPromise(Effect.flip(otherOrganization.deleteProductPreset(preset.id))) instanceof ResourceNotFound, true)
    await Effect.runPromise(restarted.deleteProductPreset(preset.id))
    assert.deepEqual(await Effect.runPromise(restarted.listProductPresets()), { items: [], nextCursor: null })
    assert.equal(await sql.one("SELECT 1 AS present FROM product_presets WHERE id=$1", [preset.id]), undefined)
  })
})

void test("rolls sequence allocation back with the surrounding transaction", async () => {
  await withMigrated("store_sequence", async ({ pool }) => {
    const store = createPostgresStore(pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "QWBE",
    })))
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "invoice", series: "ALT",
    })))
    await Effect.runPromise(store.transaction((transaction) => transaction.addDocumentSeries({
      organizationId: "org-1", documentType: "proforma", series: "QWBE",
    })))
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
       yield* transaction.allocateDocumentNumber("org-1", 2026, "invoice", "QWBE")
       yield* transaction.allocateDocumentNumber("org-1", 2026, "proforma", "QWBE")
      return yield* Effect.fail(new DomainConflict({ code: "forced", message: "rollback" }))
    }))))
    assert.equal(failure instanceof DomainConflict, true)

    // The allocation is a table row inside the transaction, not a sequence
    // object: a rollback leaves no gap, which is what fiscal numbering needs.
    const allocated = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "invoice", "QWBE")))
    assert.equal(allocated, 1)
    const alternate = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "invoice", "ALT")))
    assert.equal(alternate, 1)
    const proforma = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "proforma", "QWBE")))
    assert.equal(proforma, 1)
  })
})

/**
 * The SQLite version pointed the store at a directory with no database file.
 * The PostgreSQL equivalent of "the storage is not there" is a database with no
 * schema: the payments table does not exist, the adapter's own failure type is
 * what the caller sees, and it is the payments failure — not the invoicing one.
 */
void test("exposes payment-owned persistence failures from the payment store adapter", async () => {
  await withEmpty("store_payments", async ({ pool }) => {
    const store = createPostgresPaymentsStore(pool)
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) =>
      transaction.listPayments("org-1", "invoice-1"))))
    assert.equal(failure instanceof PaymentsPersistenceFailure, true)
  })
})

void test("round-trips document remarks and keeps them immutable once issued", async () => {
  await withMigrated("store_remarks", async ({ pool, sql }) => {
    const service = createInvoicingService({
      context: context("org-1"), clock, ids: ids(), store: createPostgresStore(pool), branding, cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer({
      name: "Exemplu SRL", fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
      legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000",
      bankName: "Banca Română", socialCapital: "1000.00",
      defaultCurrency: "RON", defaultPaymentTermDays: 15,
      vatChange: { registered: true, effectiveFrom: "2025-08-01" },
      branding: null,
    }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const customer = {
      partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" },
    }
    const remarks = "Livrare în tranșe.\nGaranție 24 de luni."
    const line = { description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
    const draft = await Effect.runPromise(service.createDraft(idempotent({ customer, series: "QWBE", issueDate: "2026-09-01", dueDate: "2026-09-16", notes: remarks })))
    await Effect.runPromise(service.addDraftLine({ draftId: draft.id, ...line }))
    assert.equal((await Effect.runPromise(service.getDraft(draft.id))).notes, remarks)
    assert.equal((await Effect.runPromise(service.listDrafts())).items[0]?.notes, remarks)
    const invoice = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
    assert.equal(invoice.notes, remarks)
    const proforma = await Effect.runPromise(service.issueProforma(idempotent({
      customer, proformaSeries: "PRO", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", lines: [line], notes: remarks,
    })))
    const readBack = createInvoicingService({ context: context("org-1"), clock, ids: ids(), store: createPostgresStore(pool), branding, cubeIdentity: "invoicing" })
    assert.equal((await Effect.runPromise(readBack.getIssuedInvoice(invoice.id))).notes, remarks)
    assert.equal((await Effect.runPromise(readBack.getProforma(proforma.id))).notes, remarks)
    assert.equal((await Effect.runPromise(readBack.listIssuedInvoices())).items[0]?.notes, remarks)
    assert.equal((await Effect.runPromise(readBack.listProformas())).items[0]?.notes, remarks)
    const open = await Effect.runPromise(service.createDraft(idempotent({ customer, series: "QWBE", issueDate: "2026-09-01" })))
    for (const [statement, values] of [
      ["UPDATE issued_invoices SET notes = 'altceva' WHERE id = $1", [invoice.id]],
      ["UPDATE proformas SET notes = 'altceva' WHERE id = $1", [proforma.id]],
      ["UPDATE issued_invoices SET issuer_branding = NULL WHERE id = $1", [invoice.id]],
      ["UPDATE proformas SET issuer_branding = NULL WHERE id = $1", [proforma.id]],
      ["UPDATE invoice_drafts SET notes = ' cu spatii ' WHERE id = $1", [open.id]],
      ["UPDATE invoice_drafts SET notes = '' WHERE id = $1", [open.id]],
    ] as ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>) {
      await refuses(sql, statement, values)
    }
    // An open draft may still have its remarks removed altogether.
    assert.equal(await sql.rowCount("UPDATE invoice_drafts SET notes = NULL WHERE id = $1", [open.id]), 1)
  })
})
