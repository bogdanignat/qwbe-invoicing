import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Either } from "effect"

import {
  DocumentNotFound,
  DocumentPersistenceFailure,
  DocumentRenderingFailure,
  DocumentsPermissionDenied,
  type ArtifactRepository,
  type InvoiceArtifact,
  type InvoiceSource,
  type RenderableCorrection,
  type RenderableInvoice,
} from "./artifact-ports.ts"
import { createArtifactService } from "./artifacts.ts"

const invoice: RenderableInvoice = {
  id: "invoice-1",
  organizationId: "org-1",
  series: "QWBE",
  number: 1,
  issueDate: "2026-09-01",
  dueDate: "2026-09-16",
  issuedAt: "2026-09-01T10:00:00.000Z",
  currency: "RON",
  notes: null,
  issuer: {
    branding: null,
    vatRegistered: true,
    name: "Știință și Tehnică SRL",
    fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Independenței 1", county: "RO-BT" },
    legalForm: "srl",
    tradeRegistryNumber: "J40/123/2020",
    socialCapital: "200.00",
    iban: "",
    bankName: "",
  },
  customer: {
    partyType: "company",
    vatRegistered: true,
    name: "Țesături România SRL",
    fiscalIdentifier: "87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Națională 2", county: "RO-IS" },
  },
  lines: [{
    description: "Servicii de consultanță",
    quantity: "1.0000",
    unitPrice: "100.00",
    unitOfMeasure: { code: "C62", name: "unitate" },
    vatRate: "21.00",
    vatCategoryCode: "S", vatExemptionReason: null,
    totalExcludingVat: "100.00",
    vatAmount: "21.00",
    totalIncludingVat: "121.00",
  }],
  vatBreakdown: [{ rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "100.00", vatAmount: "21.00" }],
  totalExcludingVat: "100.00",
  vatTotal: "21.00",
  totalIncludingVat: "121.00",
}

const context = Effect.succeed({
  identity: { id: "user-1", permissions: ["documents:read", "documents:render"] },
  organization: { id: "org-1" },
})

const memoryAdapters = (artifacts: Map<string, InvoiceArtifact>): {
  readonly repository: ArtifactRepository
  readonly source: InvoiceSource
} => ({
  repository: {
    findArtifact: (organizationId, invoiceId) => Effect.succeed(
      organizationId === invoice.organizationId ? artifacts.get(invoiceId) : undefined,
    ),
    saveArtifact: (artifact) => Effect.sync(() => {
      const existing = artifacts.get(artifact.invoiceId)
      if (existing !== undefined) return existing
      artifacts.set(artifact.invoiceId, artifact)
      return artifact
    }),
    findProformaArtifact: () => Effect.succeed(undefined),
    saveProformaArtifact: (artifact) => Effect.succeed(artifact),
  },
  source: {
    findInvoice: (organizationId, id) => Effect.succeed(
      invoice.organizationId === organizationId && invoice.id === id ? invoice : undefined,
    ),
    listIssuedInvoiceIds: (organizationId) => Effect.succeed(
      organizationId === invoice.organizationId ? [invoice.id] : [],
    ),
    findProforma: () => Effect.succeed(undefined),
    listProformaIds: () => Effect.succeed([]),
    findCorrection: () => Effect.succeed(undefined),
  },
})

void test("renders once, persists immutable metadata, and returns verified bytes", async () => {
  const artifacts = new Map<string, InvoiceArtifact>()
  let renders = 0
  const bytes = new TextEncoder().encode("deterministic-pdf-with-ș-ț")
  const service = createArtifactService({
    context,
    clock: Effect.succeed(new Date("2026-09-01T10:05:00.000Z")),
    ...memoryAdapters(artifacts),
    renderer: {
      render: () => Effect.sync(() => {
        renders += 1
        return { bytes, mediaType: "application/pdf" as const, templateVersion: "invoice-v1" }
      }),
      renderProforma: () => Effect.fail(new DocumentRenderingFailure({ template: "proforma-v1" })),
      renderCorrection: () => Effect.fail(new DocumentRenderingFailure({ template: "storno-v1" })),
    },
    objects: {
      putPdf: () => Effect.succeed({ objectKey: "sha256/abc.pdf", sha256: "abc", byteLength: bytes.length }),
      readPdf: () => Effect.succeed(bytes),
    },
    cubeIdentity: "documents",
  })

  const first = await Effect.runPromise(service.renderInvoice(invoice.id))
  const second = await Effect.runPromise(service.renderInvoice(invoice.id))
  assert.deepEqual(second, first)
  assert.equal(renders, 1)
  assert.equal(first.templateVersion, "invoice-v1")
  assert.deepEqual(await Effect.runPromise(service.downloadInvoice(invoice.id)), { artifact: first, bytes })
  assert.deepEqual(await Effect.runPromise(service.listMissingInvoiceIds()), [])
})

void test("does not persist metadata when rendering or object storage fails", async () => {
  const artifacts = new Map<string, InvoiceArtifact>()
  const service = createArtifactService({
    context,
    clock: Effect.succeed(new Date("2026-09-01T10:05:00.000Z")),
    ...memoryAdapters(artifacts),
    renderer: {
      render: () => Effect.fail(new DocumentRenderingFailure({ template: "invoice-v1" })),
      renderProforma: () => Effect.fail(new DocumentRenderingFailure({ template: "proforma-v1" })),
      renderCorrection: () => Effect.fail(new DocumentRenderingFailure({ template: "storno-v1" })),
    },
    objects: {
      putPdf: () => Effect.fail(new DocumentPersistenceFailure({ operation: "write pdf" })),
      readPdf: () => Effect.fail(new DocumentPersistenceFailure({ operation: "read pdf" })),
    },
    cubeIdentity: "documents",
  })

  await assert.rejects(Effect.runPromise(service.renderInvoice(invoice.id)))
  assert.equal(artifacts.size, 0)
})

void test("finds missing invoices after any number of healthy artifacts", async () => {
  const healthy: InvoiceArtifact = {
    invoiceId: invoice.id,
    organizationId: invoice.organizationId,
    objectKey: "sha256/aa/healthy.pdf",
    sha256: "healthy",
    byteLength: 3,
    mediaType: "application/pdf",
    templateVersion: "invoice-v1",
    generatedAt: "2026-09-01T10:05:00.000Z",
  }
  const service = createArtifactService({
    context,
    clock: Effect.succeed(new Date("2026-09-01T10:05:00.000Z")),
    repository: {
      findArtifact: (_organizationId, invoiceId) => Effect.succeed(invoiceId === invoice.id ? healthy : undefined),
      saveArtifact: (artifact) => Effect.succeed(artifact),
      findProformaArtifact: () => Effect.succeed(undefined),
      saveProformaArtifact: (artifact) => Effect.succeed(artifact),
    },
    source: {
      findInvoice: () => Effect.succeed(undefined),
      listIssuedInvoiceIds: () => Effect.succeed([invoice.id, "invoice-after-healthy-page"]),
      findProforma: () => Effect.succeed(undefined),
      listProformaIds: () => Effect.succeed([]),
      findCorrection: () => Effect.succeed(undefined),
    },
    renderer: {
      render: () => Effect.fail(new DocumentRenderingFailure({ template: "invoice-v1" })),
      renderProforma: () => Effect.fail(new DocumentRenderingFailure({ template: "proforma-v1" })),
      renderCorrection: () => Effect.fail(new DocumentRenderingFailure({ template: "storno-v1" })),
    },
    objects: {
      putPdf: () => Effect.fail(new DocumentPersistenceFailure({ operation: "write pdf" })),
      readPdf: () => Effect.succeed(new Uint8Array([1, 2, 3])),
    },
    cubeIdentity: "documents",
  })

  assert.deepEqual(await Effect.runPromise(service.listMissingInvoiceIds()), ["invoice-after-healthy-page"])
})

void test("renders a correction on demand from its source, without storing an artifact", async () => {
  const correction: RenderableCorrection = {
    ...invoice, id: "correction-1", number: 2, dueDate: null, notes: null, reason: "Anulare integrală",
    totalExcludingVat: "-100.00", vatTotal: "-21.00", totalIncludingVat: "-121.00",
    original: { series: invoice.series, number: invoice.number, issueDate: invoice.issueDate },
  }
  const bytes = new TextEncoder().encode("storno-pdf")
  const rendered: Array<RenderableCorrection> = []
  const adapters = memoryAdapters(new Map())
  const dependencies = {
    context,
    clock: Effect.succeed(new Date("2026-09-01T10:05:00.000Z")),
    repository: adapters.repository,
    source: { ...adapters.source, findCorrection: (organizationId: string, id: string) => Effect.succeed(
      organizationId === correction.organizationId && id === correction.id ? correction : undefined) },
    renderer: {
      render: () => Effect.fail(new DocumentRenderingFailure({ template: "invoice-v1" })),
      renderProforma: () => Effect.fail(new DocumentRenderingFailure({ template: "proforma-v1" })),
      renderCorrection: (source: RenderableCorrection) => Effect.sync(() => {
        rendered.push(source)
        return { bytes, mediaType: "application/pdf" as const, templateVersion: "storno-v1" }
      }),
    },
    objects: {
      putPdf: () => Effect.fail(new DocumentPersistenceFailure({ operation: "write pdf" })),
      readPdf: () => Effect.fail(new DocumentPersistenceFailure({ operation: "read pdf" })),
    },
    cubeIdentity: "documents",
  }
  const service = createArtifactService(dependencies)

  const result = await Effect.runPromise(service.renderCorrection(correction.id))
  assert.deepEqual(result, { bytes, mediaType: "application/pdf", templateVersion: "storno-v1" })
  assert.deepEqual(rendered, [correction])
  assert.deepEqual(await Effect.runPromise(Effect.either(service.renderCorrection("missing"))),
    Either.left(new DocumentNotFound({ resource: "correction", id: "missing" })))

  const renderOnly = createArtifactService({ ...dependencies, context: Effect.succeed({
    identity: { id: "user-1", permissions: ["documents:render"] }, organization: { id: "org-1" } }) })
  assert.deepEqual(await Effect.runPromise(Effect.either(renderOnly.renderCorrection(correction.id))),
    Either.left(new DocumentsPermissionDenied({ permission: "documents:read" })))
  assert.equal(rendered.length, 1)
})
