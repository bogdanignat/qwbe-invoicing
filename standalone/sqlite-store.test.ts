import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict,
  ResourceNotFound,
  createInvoicingService,
  type Clock,
  type IdGenerator,
  type RequestContextProvider,
} from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const permissions = [
  "invoicing:read",
  "invoicing:customer.manage",
  "invoicing:invoice.draft",
  "invoicing:invoice.issue",
  "invoicing:proforma.issue",
  "invoicing:settings.manage",
]

const context = (organizationId: string): RequestContextProvider => ({
  current: Effect.succeed({
    identity: { id: "user-1", username: "owner", roles: ["admin"], permissions },
    organization: { id: organizationId },
  }),
})

const clock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }

const ids = (): IdGenerator => {
  let value = 0
  return { next: Effect.sync(() => `persistent-${String(++value)}`) }
}

void test("persists an issued snapshot across store recreation and isolates organizations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-store-"))
  try {
    applyMigrations(directory)
    const service = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer({
      legalName: "Exemplu SRL",
      taxIdentifier: "RO12345674",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", postalCode: "710000" },
      defaultCurrency: "RON",
      defaultPaymentTermDays: 15,
      taxConfigurations: [{
        code: "RO_STANDARD",
        category: "standard",
        rate: "21.00",
        effectiveFrom: "2025-08-01",
      }],
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
      legalName: "Client SRL",
      taxIdentifier: "RO87654329",
      address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
    }))
    const draft = await Effect.runPromise(service.createDraft({
      customerId: customer.id,
      issueDate: "2026-09-01",
      series: "QWBE",
    }))
    const databaseBeforeIssue = new DatabaseSync(databasePath(directory))
    try {
      assert.throws(() => databaseBeforeIssue.prepare("UPDATE invoice_drafts SET series = 'PRO' WHERE id = ?").run(draft.id))
      assert.throws(() => databaseBeforeIssue.prepare("UPDATE invoice_drafts SET series = 'ALT' WHERE id = ?").run(draft.id))
    } finally {
      databaseBeforeIssue.close()
    }
    const openDraftDeletion = await Effect.runPromise(Effect.flip(service.deleteCustomer(customer.id)))
    assert.equal(openDraftDeletion instanceof DomainConflict && openDraftDeletion.code === "customer_has_open_drafts", true)
    await Effect.runPromise(service.addDraftLine({
      draftId: draft.id,
      description: "Servicii software",
      quantity: "1.25",
      unitPrice: "100.00",
      taxCode: "RO_STANDARD",
    }))
    const issued = await Effect.runPromise(service.issueInvoice({ draftId: draft.id }))
    const proformaSource = await Effect.runPromise(service.createDraft({
      customerId: customer.id, issueDate: "2026-09-01", dueDate: null, series: "QWBE",
    }))
    const proformaAuthored = await Effect.runPromise(service.addDraftLine({
      draftId: proformaSource.id, description: "Avans", quantity: "1", unitPrice: "50", taxCode: "RO_STANDARD",
    }))
    const proforma = await Effect.runPromise(service.issueProforma({ draftId: proformaSource.id, series: "PRO" }))
    assert.equal(proforma.convertedDraftId, null)
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedDraftId, null)
    assert.equal((await Effect.runPromise(service.listProformas()))[0]?.convertedDraftId, null)
    const converted = await Effect.runPromise(service.issueInvoiceFromProforma({ proformaId: proforma.id }))
    assert.deepEqual(converted.lines, proformaAuthored.lines)
    assert.equal(converted.series, "QWBE")
    assert.equal(converted.dueDate, null)
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedInvoiceId, converted.id)
    const duplicateConversion = await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma({ proformaId: proforma.id })))
    assert.equal(duplicateConversion instanceof DomainConflict && duplicateConversion.code === "proforma_already_converted", true)
    const directProforma = await Effect.runPromise(service.issueProforma({ customerId: customer.id, series: "QWBE",
      proformaSeries: "PRO", issueDate: "2026-09-02", currency: "RON",
      lines: [{ description: "Direct", quantity: "1", unitPrice: "75", taxCode: "RO_STANDARD" }] }))
    const directInvoice = await Effect.runPromise(service.issueInvoiceFromProforma({ proformaId: directProforma.id }))
    assert.equal(directInvoice.sourceProformaId, directProforma.id)
    assert.deepEqual(directInvoice.lines, directProforma.lines)
    assert.equal((await Effect.runPromise(service.getProforma(directProforma.id))).convertedInvoiceId, directInvoice.id)
    const duplicateDirect = await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma({ proformaId: directProforma.id })))
    assert.equal(duplicateDirect instanceof DomainConflict && duplicateDirect.code === "proforma_already_converted", true)

    const restarted = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(directInvoice.id)), directInvoice)
    assert.deepEqual(await Effect.runPromise(restarted.getProforma(proforma.id)), { ...proforma, convertedInvoiceId: converted.id })
    assert.deepEqual((await Effect.runPromise(restarted.listProformas())).find(({ id }) => id === proforma.id),
      { ...proforma, convertedInvoiceId: converted.id })
    assert.equal((await Effect.runPromise(restarted.getDraft(proformaSource.id))).status, "proforma_issued")
    const persistedDraft = await Effect.runPromise(restarted.getDraft(draft.id))
    assert.equal(persistedDraft.series, "QWBE")
    assert.equal(persistedDraft.customer.partyType, "company")
    assert.equal(persistedDraft.totalIncludingTax, "151.25")
    assert.deepEqual(await Effect.runPromise(restarted.listDocumentSeries()), [
      { organizationId: "org-1", documentType: "invoice", series: "ALT" },
      { organizationId: "org-1", documentType: "invoice", series: "QWBE" },
      { organizationId: "org-1", documentType: "proforma", series: "PRO" },
    ])

    await Effect.runPromise(restarted.deleteCustomer(customer.id))
    assert.deepEqual(await Effect.runPromise(restarted.listCustomers()), [])
    const deletedCustomer = await Effect.runPromise(Effect.flip(restarted.getCustomer(customer.id)))
    assert.equal(deletedCustomer instanceof ResourceNotFound, true)
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    const database = new DatabaseSync(databasePath(directory))
    try {
      assert.throws(() => database.prepare("UPDATE issued_lines SET description = ? WHERE invoice_id = ?")
        .run("tampered", issued.id))
      assert.throws(() => database.prepare("UPDATE issued_tax_breakdown SET tax_amount = ? WHERE invoice_id = ?")
        .run("0.00", issued.id))
      assert.throws(() => database.prepare("UPDATE issued_invoices SET total_including_tax = ? WHERE id = ?")
        .run("0.00", issued.id))
      assert.throws(() => database.prepare("UPDATE issued_invoices SET issuer_county = ? WHERE id = ?")
        .run("BT", issued.id))
      assert.throws(() => database.prepare("UPDATE issued_invoices SET issuer_postal_code = NULL WHERE id = ?")
        .run(issued.id))
      assert.throws(() => database.prepare("DELETE FROM issued_lines WHERE invoice_id = ?").run(issued.id))
      assert.throws(() => database.prepare("DELETE FROM issued_tax_breakdown WHERE invoice_id = ?").run(issued.id))
      assert.throws(() => database.prepare("DELETE FROM issued_invoices WHERE id = ?").run(issued.id))
      assert.throws(() => database.prepare("DELETE FROM invoice_drafts WHERE id = ?").run(draft.id))
      assert.throws(() => database.prepare("UPDATE proformas SET total_including_tax='0.00' WHERE id=?").run(proforma.id))
      assert.equal(database.prepare("SELECT sealed FROM proformas WHERE id=?").get(proforma.id)?.sealed, 1)
      assert.equal(database.prepare("SELECT actor_id FROM proforma_invoice_conversions WHERE proforma_id=?").get(proforma.id)?.actor_id, "user-1")
      assert.throws(() => database.prepare(`INSERT INTO proforma_lines
        SELECT 'late-line',proforma_id,organization_id,line_position+10,description,quantity,unit_price,tax_code,tax_category,
        tax_rate,total_excluding_tax,tax_amount,total_including_tax FROM proforma_lines WHERE proforma_id=? LIMIT 1`).run(proforma.id))
      assert.throws(() => database.prepare(`INSERT INTO proforma_tax_breakdown
        SELECT proforma_id,organization_id,line_position+10,tax_code,category,rate,taxable_amount,tax_amount
        FROM proforma_tax_breakdown WHERE proforma_id=? LIMIT 1`).run(proforma.id))
      assert.throws(() => database.prepare("DELETE FROM proforma_lines WHERE proforma_id=?").run(proforma.id))
      assert.throws(() => database.prepare("DELETE FROM proforma_tax_breakdown WHERE proforma_id=?").run(proforma.id))
      assert.throws(() => database.prepare("DELETE FROM proforma_invoice_conversions WHERE proforma_id=?").run(proforma.id))
      database.prepare(`INSERT INTO invoice_drafts SELECT 'wrong-series-source',organization_id,NULL,customer_party_type,
        customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
        customer_postal_code,series,issue_date,due_date,currency,'proforma_issued' FROM invoice_drafts WHERE id=?`).run(proformaSource.id)
      assert.throws(() => database.prepare(`INSERT INTO proformas SELECT 'wrong-series-proforma','wrong-series-source',
        organization_id,fiscal_year,document_type,'QWBE',number+10,issue_date,due_date,issued_at,currency,issuer_legal_name,
        issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_postal_code,customer_party_type,
        customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
        customer_postal_code,total_excluding_tax,tax_total,total_including_tax,0 FROM proformas WHERE id=?`).run(proforma.id))
      assert.throws(() => database.prepare(`INSERT INTO proformas SELECT 'missing-series-proforma','wrong-series-source',
        organization_id,fiscal_year,document_type,'MISSING',number+11,issue_date,due_date,issued_at,currency,issuer_legal_name,
        issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_postal_code,customer_party_type,
        customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
        customer_postal_code,total_excluding_tax,tax_total,total_including_tax,0 FROM proformas WHERE id=?`).run(proforma.id))
    } finally {
      database.close()
    }
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    const otherOrganization = createInvoicingService({
      context: context("org-2"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    const failure = await Effect.runPromise(Effect.flip(otherOrganization.getIssuedInvoice(issued.id)))
    assert.equal(failure instanceof ResourceNotFound, true)
    assert.equal(await Effect.runPromise(Effect.flip(otherOrganization.getProforma(proforma.id))) instanceof ResourceNotFound, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("rolls sequence allocation back with the surrounding transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-rollback-"))
  try {
    applyMigrations(directory)
    const store = createSqliteStore(directory)
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

    const allocated = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "invoice", "QWBE")))
    assert.equal(allocated, 1)
    const alternate = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "invoice", "ALT")))
    assert.equal(alternate, 1)
    const proforma = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateDocumentNumber("org-1", 2026, "proforma", "QWBE")))
    assert.equal(proforma, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
