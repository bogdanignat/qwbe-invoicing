import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict,
  PersistenceFailure,
  ValidationFailure,
  createInvoicingService,
  type InvoicingTransaction,
  type TransactionalStore,
} from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const each = { code: "C62", name: "unitate" } as const
const customer = {
  partyType: "company" as const,
  name: "Client SRL",
  fiscalIdentifier: "RO87654329",
  address: { countryCode: "RO", city: "Cluj", street: "Strada 2" },
}
const issuer = {
  name: "Furnizor SRL",
  fiscalIdentifier: "RO12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
  legalForm: "srl" as const,
  tradeRegistryNumber: "J22/123/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca",
  socialCapital: "1000.00",
  defaultCurrency: "RON",
  defaultPaymentTermDays: 15,
  branding: null,
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  throw new Error("request cannot be fingerprinted")
}

const idempotent = <Input>(operation: string, key: string, request: Input) => ({
  request,
  idempotency: { key, fingerprint: `sha256:${createHash("sha256").update(canonicalJson({ operation, input: request })).digest("hex")}` },
})

type Fixture = ReturnType<typeof fixture>
const fixture = (label: string, initialDate = "2026-09-05T10:00:00.000Z") => {
  const directory = mkdtempSync(join(tmpdir(), `qwbe-proforma-atomicity-${label}-`))
  applyMigrations(directory)
  let now = new Date(initialDate)
  let nextId = 0
  const dependencies = {
    context: { current: Effect.succeed({
      identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
        "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.draft",
        "invoicing:invoice.issue", "invoicing:proforma.issue",
      ] },
      organization: { id: "org-1" },
    }) },
    clock: { now: Effect.sync(() => now) },
    ids: { next: Effect.sync(() => `${label}-id-${String(++nextId)}`) },
    branding: { normalize: () => Effect.die("branding normalization is not expected") },
    cubeIdentity: "invoicing",
  } as const
  return {
    directory,
    service: (store: TransactionalStore<InvoicingTransaction> = createSqliteStore(directory)) =>
      createInvoicingService({ ...dependencies, store }),
    setDate: (value: string) => { now = new Date(value) },
    close: () => { rmSync(directory, { recursive: true, force: true }) },
  }
}

const configure = async (value: Fixture, registered = true, effectiveFrom = "2025-08-01") => {
  const service = value.service()
  await Effect.runPromise(service.configureIssuer({
    ...issuer,
    fiscalIdentifier: registered ? issuer.fiscalIdentifier : issuer.fiscalIdentifier.slice(2),
    vatChange: { registered, effectiveFrom },
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  return service
}

const issueProforma = (service: ReturnType<Fixture["service"]>, key: string, vatRateCode = "RO_STANDARD",
  issueDate = "2026-09-05", dueDate: string | null = "2026-09-20") => {
  const request = {
    customer, proformaSeries: "PRO", issueDate, dueDate, currency: "RON" as const,
    lines: [{ description: "Servicii", quantity: "2", unitPrice: "100", unitOfMeasure: each, vatRateCode }],
  }
  return Effect.runPromise(service.issueProforma(idempotent("issue_proforma_direct", key, request)))
}

const failureOf = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))
const conflict = (failure: unknown, code: string) => {
  assert.ok(failure instanceof DomainConflict)
  assert.equal(failure.code, code)
}
const scalar = (database: DatabaseSync, sql: string, ...params: ReadonlyArray<string>): number => {
  const row = database.prepare(sql).get(...params)
  assert.ok(row)
  const value = Object.values(row)[0]
  if (typeof value !== "number") throw new Error("scalar query did not return a number")
  return value
}
const databaseCounts = (directory: string) => {
  const database = new DatabaseSync(databasePath(directory), { readOnly: true })
  try {
    return {
      drafts: scalar(database, "SELECT COUNT(*) FROM invoice_drafts"),
      invoices: scalar(database, "SELECT COUNT(*) FROM issued_invoices"),
      draftConversions: scalar(database, "SELECT COUNT(*) FROM proforma_conversions"),
      invoiceConversions: scalar(database, "SELECT COUNT(*) FROM proforma_invoice_conversions"),
      idempotency: scalar(database, "SELECT COUNT(*) FROM idempotency_records"),
      audits: scalar(database, "SELECT COUNT(*) FROM audit_events"),
      invoiceSequences: scalar(database, "SELECT COUNT(*) FROM invoice_sequences WHERE document_type='invoice'"),
    }
  } finally { database.close() }
}

void test("two SQLite stores atomically choose one conversion branch and preserve idempotency", { timeout: 60_000 }, async () => {
  for (let index = 0; index < 4; index += 1) {
    const value = fixture(`race-${String(index)}`)
    try {
      const setup = await configure(value)
      const proforma = await issueProforma(setup, `source-${String(index)}`)
      const directRequest = { proformaId: proforma.id, invoiceSeries: "INV" }
      const draftRequest = { proformaId: proforma.id, invoiceSeries: "INV" }
      const directAttempt = idempotent("issue_invoice_from_proforma", `direct-${String(index)}`, directRequest)
      const draftAttempt = idempotent("create_draft_invoice_from_proforma", `draft-${String(index)}`, draftRequest)
      const first = value.service(createSqliteStore(value.directory))
      const second = value.service(createSqliteStore(value.directory))
      const directEffect = Effect.map(first.issueInvoiceFromProforma(directAttempt), ({ id }) => ({ id }))
      const draftEffect = Effect.map(second.createDraftInvoiceFromProforma(draftAttempt), ({ id }) => ({ id }))
      const reverseDraftEffect = Effect.map(first.createDraftInvoiceFromProforma(draftAttempt), ({ id }) => ({ id }))
      const reverseDirectEffect = Effect.map(second.issueInvoiceFromProforma(directAttempt), ({ id }) => ({ id }))
      const effects = index % 2 === 0 ? [directEffect, draftEffect] : [reverseDraftEffect, reverseDirectEffect]
      const outcomes = await Promise.all(effects.map((effect) => Effect.runPromise(Effect.either(effect))))
      assert.equal(outcomes.filter(({ _tag }) => _tag === "Right").length, 1)
      assert.equal(outcomes.filter(({ _tag }) => _tag === "Left").length, 1)
      const failed = outcomes.find(({ _tag }) => _tag === "Left")
      assert.ok(failed && failed._tag === "Left")
      conflict(failed.left, "proforma_already_converted")

      const database = new DatabaseSync(databasePath(value.directory), { readOnly: true })
      try {
        const draftConversions = scalar(database, "SELECT COUNT(*) FROM proforma_conversions WHERE proforma_id=?", proforma.id)
        const invoiceConversions = scalar(database, "SELECT COUNT(*) FROM proforma_invoice_conversions WHERE proforma_id=?", proforma.id)
        const derivedDrafts = scalar(database, `SELECT COUNT(*) FROM invoice_drafts d JOIN proforma_conversions c
          ON c.resulting_draft_id=d.id WHERE c.proforma_id=?`, proforma.id)
        const directInvoices = scalar(database, `SELECT COUNT(*) FROM issued_invoices i JOIN proforma_invoice_conversions c
          ON c.resulting_invoice_id=i.id WHERE c.proforma_id=?`, proforma.id)
        assert.equal(draftConversions + invoiceConversions, 1)
        assert.equal(derivedDrafts, draftConversions)
        assert.equal(directInvoices, invoiceConversions)
      } finally { database.close() }

      const directWon = outcomes[index % 2 === 0 ? 0 : 1]?._tag === "Right"
      const winner = value.service()
      const replay = directWon
        ? await Effect.runPromise(winner.issueInvoiceFromProforma(directAttempt))
        : await Effect.runPromise(winner.createDraftInvoiceFromProforma(draftAttempt))
      const succeeded = outcomes.find(({ _tag }) => _tag === "Right")
      assert.ok(succeeded && succeeded._tag === "Right")
      assert.equal(replay.id, succeeded.right.id)
      const differentKeyFailure = directWon
        ? await failureOf(winner.issueInvoiceFromProforma(idempotent("issue_invoice_from_proforma", `direct-new-${String(index)}`, directRequest)))
        : await failureOf(winner.createDraftInvoiceFromProforma(idempotent("create_draft_invoice_from_proforma", `draft-new-${String(index)}`, draftRequest)))
      conflict(differentKeyFailure, "proforma_already_converted")
    } finally { value.close() }
  }
})

const failingStore = (
  store: TransactionalStore<InvoicingTransaction>,
  method: "saveIdempotencyRecord" | "appendAuditEvent",
): TransactionalStore<InvoicingTransaction> => ({
  transaction: (use) => store.transaction((transaction) => use({
    ...transaction,
    [method]: () => Effect.fail(new PersistenceFailure({ operation: `injected ${method}` })),
  })),
})

void test("real SQLite transactions roll back late conversion failures without number gaps", { timeout: 60_000 }, async () => {
  for (const mode of ["invoice", "draft"] as const) {
    const value = fixture(`rollback-${mode}`)
    try {
      const setup = await configure(value)
      const proforma = await issueProforma(setup, `source-${mode}`)
      const before = databaseCounts(value.directory)
      const request = { proformaId: proforma.id, invoiceSeries: "INV" }
      const key = `fault-${mode}`
      const operation = mode === "invoice" ? "issue_invoice_from_proforma" : "create_draft_invoice_from_proforma"
      const attempt = idempotent(operation, key, request)
      const faulty = value.service(failingStore(createSqliteStore(value.directory), mode === "invoice" ? "saveIdempotencyRecord" : "appendAuditEvent"))
      const failure = mode === "invoice"
        ? await failureOf(faulty.issueInvoiceFromProforma(attempt))
        : await failureOf(faulty.createDraftInvoiceFromProforma(attempt))
      assert.ok(failure instanceof PersistenceFailure)
      assert.deepEqual(databaseCounts(value.directory), before)

      const clean = value.service()
      if (mode === "invoice") {
        const invoice = await Effect.runPromise(clean.issueInvoiceFromProforma(attempt))
        assert.equal(invoice.number, 1)
      } else {
        const draft = await Effect.runPromise(clean.createDraftInvoiceFromProforma(attempt))
        const invoiceAttempt = idempotent("issue_invoice_from_draft", "issue-retried-draft", { draftId: draft.id })
        const invoice = await Effect.runPromise(clean.issueInvoice(invoiceAttempt))
        assert.equal(invoice.number, 1)
      }
      const after = databaseCounts(value.directory)
      assert.equal(after.invoices, before.invoices + 1)
      assert.equal(after.invoiceSequences, before.invoiceSequences + 1)
      assert.equal(after.draftConversions + after.invoiceConversions, before.draftConversions + before.invoiceConversions + 1)
    } finally { value.close() }
  }
})

void test("derived draft lineage, guards, replay, dates, and frozen copies survive SQLite round trips", async () => {
  const value = fixture("lineage", "2026-09-10T10:00:00.000Z")
  try {
    const service = await configure(value)
    const proforma = await issueProforma(service, "lineage-source", "RO_STANDARD", "2026-09-05", "2026-09-20")
    assert.equal(Object.hasOwn(proforma, "invoiceSeries"), false)
    const original = structuredClone(proforma)

    const unknownBefore = databaseCounts(value.directory)
    const unknown = await failureOf(service.createDraftInvoiceFromProforma(idempotent(
      "create_draft_invoice_from_proforma", "unknown-series", { proformaId: proforma.id, invoiceSeries: "UNKNOWN" },
    )))
    assert.equal(unknown._tag, "ResourceNotFound")
    assert.deepEqual(databaseCounts(value.directory), unknownBefore)

    const request = { proformaId: proforma.id, invoiceSeries: "INV" }
    const attempt = idempotent("create_draft_invoice_from_proforma", "derived-draft", request)
    const draft = await Effect.runPromise(service.createDraftInvoiceFromProforma(attempt))
    assert.equal(draft.sourceProformaId, proforma.id)
    assert.equal(draft.issueDate, "2026-09-10")
    assert.equal(draft.dueDate, "2026-09-25")
    assert.equal(draft.lines.length, proforma.lines.length)
    assert.notEqual(draft.lines[0]?.id, proforma.lines[0]?.id)
    assert.deepEqual(draft.lines.map((line) => ({ ...line, id: "copied" })),
      proforma.lines.map((line) => ({ ...line, id: "copied" })))
    assert.equal((await Effect.runPromise(service.createDraftInvoiceFromProforma(attempt))).id, draft.id)

    const guardBefore = databaseCounts(value.directory)
    conflict(await failureOf(service.deleteDraft(draft.id)), "derived_draft_cannot_be_deleted")
    conflict(await failureOf(service.issueProforma(idempotent(
      "issue_proforma_from_draft", "derived-to-proforma", { draftId: draft.id, series: "PRO" },
    ))), "derived_draft_cannot_issue_proforma")
    assert.deepEqual(databaseCounts(value.directory), guardBefore)

    const ordinary = await Effect.runPromise(service.createDraft({ customer, series: "INV", issueDate: "2026-09-10" }))
    await Effect.runPromise(service.addDraftLine({ draftId: ordinary.id, description: "Avans", quantity: "1", unitPrice: "10",
      unitOfMeasure: each, vatRateCode: "RO_STANDARD" }))
    const ordinaryProforma = await Effect.runPromise(service.issueProforma(idempotent(
      "issue_proforma_from_draft", "ordinary-to-proforma", { draftId: ordinary.id, series: "PRO" },
    )))
    assert.equal(ordinaryProforma.sourceDraftId, ordinary.id)

    await Effect.runPromise(service.updateDraft({ draftId: draft.id, customer, issueDate: draft.issueDate,
      dueDate: "2026-09-26", notes: "Revizuit" }))
    const invoice = await Effect.runPromise(service.issueInvoice(idempotent("issue_invoice_from_draft", "issue-derived", { draftId: draft.id })))
    assert.equal(invoice.draftId, draft.id)
    assert.equal(invoice.sourceProformaId, proforma.id)
    const finished = await Effect.runPromise(value.service().getProforma(proforma.id))
    assert.equal(finished.convertedDraftId, draft.id)
    assert.equal(finished.convertedInvoiceId, invoice.id)
    assert.deepEqual({ ...finished, convertedDraftId: null, convertedInvoiceId: null }, original)

    const database = new DatabaseSync(databasePath(value.directory), { readOnly: true })
    try {
      assert.equal(scalar(database, "SELECT COUNT(*) FROM proforma_conversions WHERE proforma_id=?", proforma.id), 1)
      assert.equal(scalar(database, "SELECT COUNT(*) FROM proforma_invoice_conversions WHERE proforma_id=?", proforma.id), 0)
    } finally { database.close() }
  } finally { value.close() }
})

void test("VAT regime changes do not silently recompute a derived draft", async () => {
  const value = fixture("vat")
  try {
    const service = await configure(value, false, "2025-08-01")
    const proforma = await issueProforma(service, "non-vat-source", "RO_NON_VAT")
    const original = structuredClone(proforma)
    assert.equal(proforma.issuer.vatRegistered, false)
    assert.deepEqual(proforma.lines.map(({ vatRateCode, vatRate, vatAmount }) => ({ vatRateCode, vatRate, vatAmount })),
      [{ vatRateCode: "RO_NON_VAT", vatRate: "0.00", vatAmount: "0.00" }])

    value.setDate("2026-09-10T10:00:00.000Z")
    await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: true, effectiveFrom: "2026-09-10" } }))
    const request = { proformaId: proforma.id, invoiceSeries: "INV" }
    const draft = await Effect.runPromise(service.createDraftInvoiceFromProforma(idempotent(
      "create_draft_invoice_from_proforma", "vat-derived", request,
    )))
    assert.equal(draft.issueDate, "2026-09-10")
    const copiedLine = draft.lines[0]
    assert.ok(copiedLine)
    assert.equal(copiedLine.vatRateCode, "RO_NON_VAT")
    assert.equal(copiedLine.vatRate, "0.00")
    assert.equal(databaseCounts(value.directory).invoices, 0)

    const stale = await failureOf(service.issueInvoice(idempotent("issue_invoice_from_draft", "stale-derived", { draftId: draft.id })))
    assert.ok(stale instanceof ValidationFailure)
    assert.ok(stale.issues.some((issue) => issue.includes("requires a non-VAT issuer")))
    assert.equal(databaseCounts(value.directory).invoices, 0)

    const line = draft.lines[0]
    assert.ok(line)
    const updated = await Effect.runPromise(service.updateDraftLine({ draftId: draft.id, lineId: line.id,
      description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
      unitOfMeasure: line.unitOfMeasure, vatRateCode: "RO_STANDARD" }))
    assert.equal(updated.lines[0]?.vatRate, "21.00")
    const invoice = await Effect.runPromise(service.issueInvoice(idempotent("issue_invoice_from_draft", "current-derived", { draftId: draft.id })))
    assert.equal(invoice.issuer.vatRegistered, true)
    assert.equal(invoice.sourceProformaId, proforma.id)
    assert.deepEqual(await Effect.runPromise(service.getProforma(proforma.id)), { ...original,
      convertedDraftId: draft.id, convertedInvoiceId: invoice.id })
  } finally { value.close() }
})
