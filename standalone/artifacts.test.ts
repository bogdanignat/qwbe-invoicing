import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../cube/invoicing/index.ts"
import { createArtifactService } from "../cube/invoicing/documents/index.ts"
import { reconcileArtifacts } from "./artifact-reconciliation.ts"
import { createPdfObjectStore } from "./artifact-store.ts"
import { applyMigrations, documentsDatabasePath } from "./migrations.ts"
import { createPdfRenderer } from "./pdf-renderer.ts"
import { createArtifactRepository, createInvoiceSource } from "./sqlite-artifacts.ts"
import { createSqliteStore } from "./sqlite-store.ts"
const each = { code: "C62", name: "unitate" } as const
const idempotent = <Input>(key: string, request: Input) => ({ request, idempotency: { key, fingerprint: `sha256:${"0".repeat(64)}` } })

const issueFixture = async (directory: string): Promise<{ readonly invoiceId: string; readonly proformaId: string }> => {
  let nextId = 0
  const service = createInvoicingService({
    context: { current: Effect.succeed({
      identity: {
        id: "user-1",
        username: "owner",
        roles: ["admin"],
        permissions: ["invoicing:settings.manage", "invoicing:customer.manage", "invoicing:invoice.draft", "invoicing:invoice.issue", "invoicing:proforma.issue"],
      },
      organization: { id: "org-1" },
    }) },
    clock: { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) },
    ids: { next: Effect.sync(() => `id-${String(++nextId)}`) },
    store: createSqliteStore(directory),
    cubeIdentity: "invoicing",
  })
  await Effect.runPromise(service.configureIssuer({
    name: "Știință și Tehnică SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Independenței 1" },
    defaultCurrency: "RON",
    defaultPaymentTermDays: 15,
    vatConfigurations: [{ code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }],
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const customer = await Effect.runPromise(service.createCustomer({
    partyType: "company",
    name: "Țesături România SRL",
    fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Națională 2" },
  }))
  const draft = await Effect.runPromise(service.createDraft({ customerId: customer.id, issueDate: "2026-09-01", series: "QWBE" }))
  await Effect.runPromise(service.addDraftLine({
    draftId: draft.id,
    description: "Servicii de consultanță",
    quantity: "1",
    unitPrice: "100",
    unitOfMeasure: each,
    vatRateCode: "RO_STANDARD",
  }))
  const invoiceId = (await Effect.runPromise(service.issueInvoice(idempotent("fixture-invoice", { draftId: draft.id })))).id
  const proformaDraft = await Effect.runPromise(service.createDraft({
    customerId: customer.id, issueDate: "2026-09-01", dueDate: null, series: "QWBE",
  }))
  await Effect.runPromise(service.addDraftLine({
    draftId: proformaDraft.id, description: "Avans", quantity: "1", unitPrice: "50", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  }))
  const proformaId = (await Effect.runPromise(service.issueProforma(idempotent("fixture-proforma", { draftId: proformaDraft.id, series: "PRO" })))).id
  return { invoiceId, proformaId }
}

void test("persists, reloads, and integrity-checks immutable PDF artifacts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-artifacts-"))
  try {
    applyMigrations(directory)
    const { invoiceId, proformaId } = await issueFixture(directory)
    const service = createArtifactService({
      context: Effect.succeed({
        identity: { id: "user-1", permissions: ["documents:read", "documents:render"] },
        organization: { id: "org-1" },
      }),
      clock: Effect.succeed(new Date("2026-09-01T10:05:00.000Z")),
      repository: createArtifactRepository(directory),
      source: createInvoiceSource(directory),
      renderer: createPdfRenderer(),
      objects: createPdfObjectStore(directory),
      cubeIdentity: "documents",
    })

    assert.deepEqual(await reconcileArtifacts(service, 10, false), {
      scanned: 2,
      changed: 0,
      skipped: 2,
      failed: 0,
      pending: 2,
    })
    assert.deepEqual(await reconcileArtifacts(service, 10, true), {
      scanned: 2,
      changed: 2,
      skipped: 0,
      failed: 0,
      pending: 0,
    })
    const first = await Effect.runPromise(service.renderInvoice(invoiceId))
    const second = await Effect.runPromise(service.renderInvoice(invoiceId))
    assert.deepEqual(second, first)
    const download = await Effect.runPromise(service.downloadInvoice(invoiceId))
    assert.equal(download.bytes.length, first.byteLength)
    assert.equal(Buffer.from(download.bytes.subarray(0, 5)).toString("ascii"), "%PDF-")
    const firstProforma = await Effect.runPromise(service.renderProforma(proformaId))
    assert.deepEqual(await Effect.runPromise(service.renderProforma(proformaId)), firstProforma)
    assert.equal(firstProforma.templateVersion, "proforma-v1")
    assert.equal((await Effect.runPromise(service.downloadProforma(proformaId))).bytes.length, firstProforma.byteLength)

    const database = new DatabaseSync(documentsDatabasePath(directory))
    try {
      assert.throws(() => database.prepare("UPDATE invoice_artifacts SET byte_length = 1 WHERE invoice_id = ?").run(invoiceId))
      assert.throws(() => database.prepare("DELETE FROM invoice_artifacts WHERE invoice_id = ?").run(invoiceId))
      assert.throws(() => database.prepare("UPDATE proforma_artifacts SET byte_length = 1 WHERE proforma_id = ?").run(proformaId))
      assert.throws(() => database.prepare("DELETE FROM proforma_artifacts WHERE proforma_id = ?").run(proformaId))
    } finally {
      database.close()
    }

    writeFileSync(join(directory, "artifacts", first.objectKey), "tampered")
    await assert.rejects(Effect.runPromise(service.downloadInvoice(invoiceId)))
    assert.equal((await reconcileArtifacts(service, 10, false)).pending, 1)
    assert.equal((await reconcileArtifacts(service, 10, true)).changed, 1)
    assert.equal((await Effect.runPromise(service.downloadInvoice(invoiceId))).bytes.length, first.byteLength)
    const restarted = createArtifactService({
      context: Effect.succeed({ identity: { id: "user-1", permissions: ["documents:read", "documents:render"] }, organization: { id: "org-1" } }),
      clock: Effect.succeed(new Date("2026-09-02T00:00:00.000Z")), repository: createArtifactRepository(directory),
      source: createInvoiceSource(directory), renderer: createPdfRenderer(), objects: createPdfObjectStore(directory), cubeIdentity: "documents",
    })
    assert.deepEqual(await Effect.runPromise(restarted.renderProforma(proformaId)), firstProforma)
    const isolated = createArtifactService({
      context: Effect.succeed({ identity: { id: "user-2", permissions: ["documents:read", "documents:render"] }, organization: { id: "org-2" } }),
      clock: Effect.succeed(new Date()), repository: createArtifactRepository(directory), source: createInvoiceSource(directory),
      renderer: createPdfRenderer(), objects: createPdfObjectStore(directory), cubeIdentity: "documents",
    })
    await assert.rejects(Effect.runPromise(isolated.downloadProforma(proformaId)))
    await assert.rejects(Effect.runPromise(isolated.renderProforma(proformaId)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("allows distinct invoices to reference identical content-addressed bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-artifact-deduplication-"))
  try {
    applyMigrations(directory)
    const repository = createArtifactRepository(directory)
    const common = {
      objectKey: `sha256/${"a".repeat(2)}/${"a".repeat(64)}.pdf`,
      sha256: "a".repeat(64),
      byteLength: 100,
      mediaType: "application/pdf" as const,
      templateVersion: "invoice-v1",
      generatedAt: "2026-09-01T10:05:00.000Z",
    }
    await Effect.runPromise(repository.saveArtifact({ ...common, invoiceId: "invoice-1", organizationId: "org-1" }))
    await Effect.runPromise(repository.saveArtifact({ ...common, invoiceId: "invoice-2", organizationId: "org-2" }))
    assert.equal((await Effect.runPromise(repository.findArtifact("org-1", "invoice-1")))?.sha256, common.sha256)
    assert.equal((await Effect.runPromise(repository.findArtifact("org-2", "invoice-2")))?.sha256, common.sha256)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
