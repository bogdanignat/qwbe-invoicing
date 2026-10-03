import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict, createInvoicingService,
  type Clock, type IdGenerator, type RequestContextProvider,
} from "../../cube/invoicing/index.ts"
import { createPaymentsService } from "../../cube/payments/index.ts"
import { writeFailure } from "./postgres-errors.ts"
import { createPostgresArtifactRepository } from "./postgres-artifact-repository.ts"
import { freshRuntime } from "./postgres-rig.test-support.ts"
import { businessTransaction, createPostgresPaymentsStore, createPostgresStore } from "./postgres-store.ts"

/**
 * The adapters against the real PostgreSQL 16 schema, driven through the cubes'
 * own services — the same way the SQLite suite drove them. Nothing is mocked:
 * the triggers, the CHECKs, the deferred cycle and the folded index are the
 * behaviour being measured.
 */

const permissions = [
  "invoicing:read", "invoicing:customer.manage", "invoicing:invoice.draft", "invoicing:invoice.issue",
  "invoicing:proforma.issue", "invoicing:invoice.void", "invoicing:settings.manage",
  "payments:read", "payments:payment.record",
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

let keyCounter = 0
const idempotent = <Input>(request: Input) => {
  keyCounter += 1
  return { request, idempotency: { key: `pg-${String(keyCounter)}`, fingerprint: `sha256:${"0".repeat(64)}` } }
}

const ids = (): IdGenerator => {
  let value = 0
  return { next: Effect.sync(() => { value += 1; return `pg-id-${String(value)}` }) }
}

const issuerRequest = {
  name: "Exemplu SRL", fiscalIdentifier: "12345674",
  address: {
    countryCode: "RO", city: "București", street: "Strada Mare 1",
    county: "RO-B", sector: 2, postalCode: "020000",
  },
  legalForm: "srl" as const, tradeRegistryNumber: "J22/123/2020",
  iban: "RO49AAAA1B31007593840000", bankName: "Banca Română", socialCapital: "1000.00",
  defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true as const, effectiveFrom: "2025-08-01" },
  branding: { text: "  Marca A  ", image: { dataBase64: "iVBORw0KGgo=" } },
}

void test("every port round-trips through the real schema, and money keeps its exact text", async () => {
  const runtime = await freshRuntime("ports")
  try {
    const idGenerator = ids()
    const service = createInvoicingService({
      context: context("org-1"), clock, ids: idGenerator,
      store: createPostgresStore(runtime.pool), branding, cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer(issuerRequest))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const duplicateSeries = await Effect.runPromise(Effect.flip(
      service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }),
    ))
    assert.equal(duplicateSeries instanceof DomainConflict && duplicateSeries.code === "document_series_exists", true)

    const customer = await Effect.runPromise(service.createCustomer({
      partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "București", street: "Strada Mică 2", county: "RO-B", sector: 3 },
      defaultPaymentTermDays: 14,
    }))
    // Money is TEXT on both engines: the normalised string arrives back
    // character for character, never as a float.
    const preset = await Effect.runPromise(service.createProductPreset({
      description: "  Servicii software  ", unitPrice: "125.5", unitOfMeasure: each,
    }))
    assert.equal(preset.unitPrice, "125.50")
    assert.deepEqual(await Effect.runPromise(service.listProductPresets()), { items: [preset], nextCursor: null })

    const draft = await Effect.runPromise(service.createDraft(idempotent({
      customerId: customer.id, issueDate: "2026-09-01", dueDate: "2026-09-16", series: "QWBE",
      source: { app: "crm", kind: "contract", id: "contract-1" },
    })))
    await Effect.runPromise(service.addDraftLine({
      draftId: draft.id, description: "Servicii software", quantity: "1.25", unitPrice: "100.00",
      unitOfMeasure: each, vatRateCode: "RO_STANDARD",
    }))
    const reread = await Effect.runPromise(service.getDraft(draft.id))
    // The domain normalises a quantity to four decimals; the column is TEXT, so
    // exactly those characters come back.
    const [line] = reread.lines
    assert.ok(line)
    assert.equal(line.quantity, "1.2500")
    assert.equal(line.unitPrice, "100.00")

    const issued = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: draft.id })))
    assert.equal(issued.actorId, "user-1")
    assert.equal(issued.number, 1)
    assert.equal(issued.totalExcludingVat, "125.00")
    assert.deepEqual(issued.issuer.branding, {
      text: "Marca A", image: { pngBase64: "iVBORw0KGgo=", width: 12, height: 6 },
    })
    // The summary projection selects issuer_branding as NULL, so a list answer
    // carries no logo and the decoder still finds the field.
    const [summary] = (await Effect.runPromise(service.listIssuedInvoices())).items
    assert.ok(summary)
    assert.equal(summary.id, issued.id)
    assert.equal("branding" in summary.issuer, false)

    const payments = createPaymentsService({
      context: context("org-1"), clock, ids: idGenerator,
      store: createPostgresPaymentsStore(runtime.pool), cubeIdentity: "payments",
    })
    const attempt = idempotent({
      invoiceId: issued.id, amount: "25", currency: "RON", paymentDate: "2026-09-01", method: "transfer",
    })
    const payment = await Effect.runPromise(payments.recordPayment(attempt))
    assert.equal(payment.payment.amount, "25.00")
    // The idempotency record is read back from PostgreSQL, so a replay answers
    // the stored result instead of writing a second payment.
    assert.deepEqual(await Effect.runPromise(payments.recordPayment(attempt)), payment)

    const proformaDraft = await Effect.runPromise(service.createDraft(idempotent({
      customerId: customer.id, issueDate: "2026-09-01", dueDate: "2026-09-16", series: "QWBE",
      source: { app: "crm", kind: "offer", id: "offer-1" },
    })))
    const authored = await Effect.runPromise(service.addDraftLine({
      draftId: proformaDraft.id, description: "Avans", quantity: "1", unitPrice: "50",
      unitOfMeasure: each, vatRateCode: "RO_STANDARD",
    }))
    const proforma = await Effect.runPromise(service.issueProforma(idempotent({
      draftId: proformaDraft.id, series: "PRO",
    })))
    assert.equal(proforma.convertedDraftId, null)
    const converted = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({
      proformaId: proforma.id, invoiceSeries: "QWBE",
    })))
    assert.deepEqual(converted.lines, authored.lines)
    assert.equal((await Effect.runPromise(service.getProforma(proforma.id))).convertedInvoiceId, converted.id)
    // The conversion ledger's unique key is what refuses the second conversion,
    // and its SQLSTATE is mapped to the domain's own code, not to a 500.
    const duplicate = await Effect.runPromise(Effect.flip(service.issueInvoiceFromProforma(idempotent({
      proformaId: proforma.id, invoiceSeries: "QWBE",
    }))))
    assert.equal(duplicate instanceof DomainConflict && duplicate.code === "proforma_already_converted", true)

    // A proforma issued without a draft exercises the generated column that
    // closes the FK cycle, deferred to COMMIT.
    const direct = await Effect.runPromise(service.issueProforma(idempotent({
      customerId: customer.id, proformaSeries: "PRO", issueDate: "2026-09-01", dueDate: "2026-09-16",
      currency: "RON",
      lines: [{ description: "Direct", quantity: "1", unitPrice: "75", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
    })))
    const directInvoice = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({
      proformaId: direct.id, invoiceSeries: "QWBE",
    })))
    assert.equal(directInvoice.sourceProformaId, direct.id)

    const correction = await Effect.runPromise(service.createCorrection(idempotent({
      originalInvoiceId: issued.id, reason: "Corecție fiscală",
    })))
    assert.equal(correction.actorId, "user-1")
    const register = await Effect.runPromise(service.listInvoiceRegister())
    const kinds = register.items.map((entry) => entry.kind)
    assert.equal(kinds.includes("invoice"), true)
    assert.equal(kinds.includes("correction"), true)
    const corrections = await Effect.runPromise(service.listCorrections(issued.id))
    assert.deepEqual(corrections.map((entry) => entry.id), [correction.id])
  } finally {
    await runtime.close()
  }
})

/**
 * The placeholder arithmetic of the composed lists, executed by PostgreSQL.
 *
 * `nameKeyset` was already covered with a cursor; the document, draft and
 * register keysets were only ever checked as SQL shapes. Those are the hardest
 * numbering in the unit — the register binds nineteen values across two halves —
 * and a regression there is a runtime `42P02` or a wrong page, not a type error.
 * So each list is paged with `after` AND a `source` filter, and the second page's
 * rows are asserted.
 */
void test("every composed keyset pages correctly on the engine, with a source filter", async () => {
  const runtime = await freshRuntime("paging")
  try {
    const service = createInvoicingService({
      context: context("org-1"), clock, ids: ids(),
      store: createPostgresStore(runtime.pool), branding, cubeIdentity: "invoicing",
    })
    const store = createPostgresStore(runtime.pool)
    await Effect.runPromise(service.configureIssuer(issuerRequest))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const customer = await Effect.runPromise(service.createCustomer({
      partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada 1", county: "RO-CJ" },
    }))
    const source = { app: "crm", kind: "contract", id: "contract-1" }
    const other = { app: "crm", kind: "contract", id: "contract-2" }

    const draftOn = async (issueDate: string, documentSource: typeof source) => {
      const draft = await Effect.runPromise(service.createDraft(idempotent({
        customerId: customer.id, issueDate, dueDate: "2026-09-30", series: "QWBE", source: documentSource,
      })))
      await Effect.runPromise(service.addDraftLine({
        draftId: draft.id, description: "Servicii", quantity: "1", unitPrice: "100.00",
        unitOfMeasure: each, vatRateCode: "RO_STANDARD",
      }))
      return draft
    }

    // Drafts: two in the filtered source, one outside it, so the filter has to
    // bite as well as the cursor. Dates sit before the clock's 2026-09-01 because
    // issuance is chronological per series and the correction below is dated by
    // the clock.
    const laterDraft = await draftOn("2026-08-31", source)
    const earlierDraft = await draftOn("2026-08-30", source)
    await draftOn("2026-08-29", other)
    const firstDrafts = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listDrafts("org-1", { limit: 1 }, source)))
    assert.deepEqual(firstDrafts.map((draft) => draft.id), [laterDraft.id, earlierDraft.id])
    const nextDrafts = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listDrafts("org-1", { limit: 1, after: { issueDate: "2026-08-31", id: laterDraft.id } }, source)))
    assert.deepEqual(nextDrafts.map((draft) => draft.id), [earlierDraft.id])

    // Issued invoices: the document keyset's six placeholders start after the
    // source filter's three.
    const secondInvoice = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: earlierDraft.id })))
    const firstInvoice = await Effect.runPromise(service.issueInvoice(idempotent({ draftId: laterDraft.id })))
    const firstPage = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listIssuedInvoices("org-1", { limit: 1 }, source)))
    assert.deepEqual(firstPage.map((invoice) => invoice.id), [firstInvoice.id, secondInvoice.id])
    const nextPage = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listIssuedInvoices("org-1", {
        limit: 1, after: { issueDate: firstInvoice.issueDate, number: firstInvoice.number, id: firstInvoice.id },
      }, source)))
    assert.deepEqual(nextPage.map((invoice) => invoice.id), [secondInvoice.id])

    // Proformas: the same keyset, prefixed `p.` over three joins. Issued in date
    // order, because the PRO series is chronological too.
    const earlierProformaDraft = await draftOn("2026-08-20", source)
    const earlierProforma = await Effect.runPromise(service.issueProforma(idempotent({
      draftId: earlierProformaDraft.id, series: "PRO",
    })))
    const laterProformaDraft = await draftOn("2026-08-21", source)
    const laterProforma = await Effect.runPromise(service.issueProforma(idempotent({
      draftId: laterProformaDraft.id, series: "PRO",
    })))
    const proformaPage = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listProformas("org-1", {
        limit: 1, after: { issueDate: laterProforma.issueDate, number: laterProforma.number, id: laterProforma.id },
      }, source)))
    assert.deepEqual(proformaPage.map((proforma) => proforma.id), [earlierProforma.id])

    // The register: two organization placeholders, two source filters, a
    // four-level keyset and the limit — nineteen bound values in one statement.
    const correction = await Effect.runPromise(service.createCorrection(idempotent({
      originalInvoiceId: firstInvoice.id, reason: "Corecție fiscală",
    })))
    const register = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listInvoiceRegister("org-1", { limit: 10 }, source)))
    assert.deepEqual(
      register.map((entry) => entry.id),
      [correction.id, firstInvoice.id, secondInvoice.id],
    )
    const registerHead = register[0]
    assert.ok(registerHead)
    const registerNext = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listInvoiceRegister("org-1", {
        limit: 10,
        after: {
          issueDate: registerHead.issueDate, number: registerHead.number,
          id: registerHead.id, kind: registerHead.kind,
        },
      }, source)))
    assert.deepEqual(registerNext.map((entry) => entry.id), [firstInvoice.id, secondInvoice.id])
  } finally {
    await runtime.close()
  }
})

void test("the folded keyset pages case-insensitively, cursor included", async () => {
  const runtime = await freshRuntime("keyset")
  try {
    const store = createPostgresStore(runtime.pool)
    const names = ["bravo", "Alpha", "ALPHA2", "charlie", "Ălpha"]
    await Effect.runPromise(store.transaction((transaction) => Effect.forEach(
      names,
      (name, index) => transaction.saveCustomer({
        id: `c-${String(index)}`, organizationId: "org-1", partyType: "company", name,
        fiscalIdentifier: "87654329", vatRegistered: true,
        // Not RO-B: `customers_bucharest_sector` requires a sector there, and
        // this case is about ordering, not about the address rule.
        address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada 1", county: "RO-CJ" },
      }),
      { discard: true },
    )))
    const first = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listCustomers("org-1", { limit: 2 })))
    // limit 2 asks for 3 rows, so the caller can tell there is another page.
    assert.deepEqual(first.map((customer) => customer.name), ["Alpha", "ALPHA2", "bravo"])

    // The cursor is spelled in a different case than the stored row: folding only
    // the column would place it on the wrong side of the comparison.
    const second = await Effect.runPromise(store.transaction((transaction) =>
      transaction.listCustomers("org-1", { limit: 2, after: { name: "alpha2", id: "c-2" } })))
    assert.deepEqual(second.map((customer) => customer.name), ["bravo", "charlie", "Ălpha"])
    // The fold is ASCII only, exactly as NOCASE was: `Ă` is not folded, so it
    // sorts after every lowercase ASCII name.
    assert.equal(second.at(-1)?.name, "Ălpha")
  } finally {
    await runtime.close()
  }
})

void test("a trigger, a CHECK and a type error all become a 409-shaped conflict", async () => {
  const runtime = await freshRuntime("errors")
  try {
    const raw = businessTransaction(runtime.pool)
    // The error is carried back as a value: the aborted transaction is then
    // committed, which PostgreSQL turns into a rollback, and the pool survives.
    const errorOf = async (sql: string, values: ReadonlyArray<string | number>): Promise<unknown> =>
      Effect.runPromise(raw((client) => Effect.promise(async () => {
        try {
          await client.query(sql, values)
          return undefined
        } catch (error) {
          return error
        }
      })))

    // A CHECK: the translated money pattern refuses a three-decimal price.
    const check = await errorOf(
      `INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name)
        VALUES($1,$2,$3,$4,$5,$6)`,
      ["p-1", "org-1", "Preț", "1.000", "C62", "unitate"],
    )
    assert.equal((check as { readonly code?: string }).code, "23514")
    const mappedCheck = writeFailure(check, "save product preset")
    assert.equal(mappedCheck instanceof DomainConflict && mappedCheck.code === "persistence_conflict", true)

    // A type violation: PostgreSQL answers 22P02 where STRICT SQLite answered
    // SQLITE_CONSTRAINT_DATATYPE, and both have to reach the same 409.
    const typeError = await errorOf(
      "INSERT INTO invoice_sequences(organization_id,fiscal_year,document_type,series,last_number) VALUES($1,$2,$3,$4,$5)",
      ["org-1", "not-a-year", "invoice", "QWBE", 1],
    )
    assert.equal((typeError as { readonly code?: string }).code, "22P02")
    const mappedType = writeFailure(typeError, "allocate document number")
    assert.equal(mappedType instanceof DomainConflict && mappedType.code === "persistence_conflict", true)

    // A trigger: `audit_events_no_update` runs the shared foundation function,
    // which raises 23514, so a refused write is a conflict and not a 500.
    await Effect.runPromise(raw((client) => Effect.promise(async () => {
      await client.query(
        `INSERT INTO audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        ["a-1", "org-1", "user-1", "2026-09-01T10:00:00.000Z", "issue", "invoice", "inv-1", null],
      )
    })))
    const triggerError = await errorOf(
      "UPDATE audit_events SET action = $1 WHERE id = $2", ["tampered", "a-1"],
    )
    assert.equal((triggerError as { readonly code?: string }).code, "23514")
    const mappedTrigger = writeFailure(triggerError, "add document series")
    assert.equal(mappedTrigger instanceof DomainConflict && mappedTrigger.code === "persistence_conflict", true)
  } finally {
    await runtime.close()
  }
})

void test("artifact metadata is idempotent and refuses a different artifact for the same invoice", async () => {
  const runtime = await freshRuntime("artifacts")
  try {
    const repository = createPostgresArtifactRepository(runtime.pool)
    const artifact = {
      invoiceId: "inv-1", organizationId: "org-1", objectKey: "ab/cd/abcd.pdf",
      sha256: "a".repeat(64), byteLength: 1024, mediaType: "application/pdf" as const,
      templateVersion: "v1", generatedAt: "2026-09-01T10:00:00.000Z",
    }
    assert.deepEqual(await Effect.runPromise(repository.saveArtifact(artifact)), artifact)
    assert.deepEqual(await Effect.runPromise(repository.saveArtifact(artifact)), artifact)
    assert.deepEqual(await Effect.runPromise(repository.findArtifact("org-1", "inv-1")), artifact)
    const conflict = await Effect.runPromise(Effect.flip(
      repository.saveArtifact({ ...artifact, sha256: "b".repeat(64) }),
    ))
    assert.equal(conflict._tag, "ArtifactConflict")
    // The conflict rolled the transaction back: the stored row is untouched.
    assert.deepEqual(await Effect.runPromise(repository.findArtifact("org-1", "inv-1")), artifact)
    assert.equal(await Effect.runPromise(repository.findProformaArtifact("org-1", "pro-1")), undefined)
  } finally {
    await runtime.close()
  }
})
