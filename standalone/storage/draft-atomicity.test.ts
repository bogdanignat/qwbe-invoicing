import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict, PersistenceFailure, createInvoicingService, type InvoicingDependencies,
} from "../../cube/invoicing/index.ts"
import { migratedFixture, type RawSql, type TestFixture } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * Draft creation atomicity on PostgreSQL 16. The fixture is a fresh database per
 * case instead of a fresh directory, and the counts are read with `Number`
 * around them: `count(*)` is `bigint`, which arrives as a string and would
 * compare unequal to a number for ever.
 */

const each = { code: "C62", name: "unitate" } as const
const customer = {
  partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Cluj", street: "Strada 2", county: "RO-CJ" },
}
const issuer = {
  name: "Furnizor SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl" as const, tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000",
  bankName: "Banca", socialCapital: "1000.00", defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
}
const line = { description: "Servicii", quantity: "2", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  throw new Error("request cannot be fingerprinted")
}
// The same fingerprint the HTTP layer computes, so a changed payload here is a
// changed payload there.
const idempotent = <Input>(key: string, request: Input) => ({
  request,
  idempotency: { key, fingerprint: `sha256:${createHash("sha256").update(canonicalJson({ operation: "create_draft", input: request })).digest("hex")}` },
})

interface Fixture {
  readonly database: TestFixture
  readonly service: (store?: InvoicingDependencies["store"]) => ReturnType<typeof createInvoicingService>
  readonly close: () => Promise<void>
}
const fixture = async (label: string): Promise<Fixture> => {
  const database = await migratedFixture(`draft_${label}`)
  let nextId = 0
  const dependencies = {
    context: { current: Effect.succeed({
      identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
        "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.draft", "invoicing:invoice.issue",
      ] },
      organization: { id: "org-1" },
    }) },
    clock: { now: Effect.sync(() => new Date("2026-09-05T10:00:00.000Z")) },
    ids: { next: Effect.sync(() => `${label}-id-${String(++nextId)}`) },
    branding: { normalize: () => Effect.die("branding normalization is not expected") },
    cubeIdentity: "invoicing",
  } as const
  return {
    database,
    service: (store: InvoicingDependencies["store"] = createPostgresStore(database.pool)) =>
      createInvoicingService({ ...dependencies, store }),
    close: () => database.close(),
  }
}

const configure = async (value: Fixture) => {
  const service = value.service()
  await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01" } }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  return service
}

const failureOf = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))
const scalar = async (sql: RawSql, statement: string): Promise<number> => {
  const value = Number(await sql.scalar(statement))
  if (!Number.isInteger(value)) throw new Error(`scalar query did not return a count: ${statement}`)
  return value
}
const counts = async (sql: RawSql) => ({
  drafts: await scalar(sql, "SELECT COUNT(*) FROM invoice_drafts"),
  lines: await scalar(sql, "SELECT COUNT(*) FROM draft_lines"),
  idempotency: await scalar(sql, "SELECT COUNT(*) FROM idempotency_records WHERE operation='create_draft'"),
  audits: await scalar(sql, "SELECT COUNT(*) FROM audit_events WHERE action='draft.created'"),
})

const failingStore = (
  store: InvoicingDependencies["store"],
  method: "saveIdempotencyRecord" | "appendAuditEvent",
): InvoicingDependencies["store"] => ({
  transaction: (use) => store.transaction((transaction) => use({
    ...transaction,
    [method]: () => Effect.fail(new PersistenceFailure({ operation: `injected ${method}` })),
  })),
})

const request = { customer, series: "INV", issueDate: "2026-09-05", dueDate: "2026-09-20", lines: [line, line] }

void test("a failed draft creation leaves no header, no line, no key and no audit entry behind", { timeout: 60_000 }, async () => {
  for (const method of ["saveIdempotencyRecord", "appendAuditEvent"] as const) {
    const value = await fixture(`rollback_${method === "appendAuditEvent" ? "audit" : "idem"}`)
    try {
      await configure(value)
      const before = await counts(value.database.sql)
      const attempt = idempotent(`fault-${method}`, request)
      const faulty = value.service(failingStore(createPostgresStore(value.database.pool), method))
      assert.ok(await failureOf(faulty.createDraft(attempt)) instanceof PersistenceFailure)
      assert.deepEqual(await counts(value.database.sql), before)

      // The key was never spent, so the honest retry authors the draft once.
      const draft = await Effect.runPromise(value.service().createDraft(attempt))
      assert.equal(draft.lines.length, 2)
      assert.deepEqual(await counts(value.database.sql), { drafts: before.drafts + 1, lines: before.lines + 2,
        idempotency: before.idempotency + 1, audits: before.audits + 1 })
    } finally { await value.close() }
  }
})

void test("two stores racing on one creation key produce exactly one draft", { timeout: 60_000 }, async () => {
  for (let index = 0; index < 4; index += 1) {
    const value = await fixture(`race_${String(index)}`)
    try {
      await configure(value)
      const attempt = idempotent(`race-${String(index)}`, request)
      const first = value.service(createPostgresStore(value.database.pool))
      const second = value.service(createPostgresStore(value.database.pool))
      const outcomes = await Promise.all([first, second].map((service) =>
        Effect.runPromise(Effect.either(Effect.map(service.createDraft(attempt), ({ id }) => id)))))
      // Whoever loses the race either waits on the exclusive business lock and
      // replays the winner's draft, or the lock timeout turns it into a server
      // failure the caller retries. What may never happen is two drafts from one
      // key.
      const identifiers = new Set(outcomes.flatMap((outcome) => outcome._tag === "Right" ? [outcome.right] : []))
      assert.equal(identifiers.size, 1)
      assert.deepEqual(await counts(value.database.sql), { drafts: 1, lines: 2, idempotency: 1, audits: 1 })
      for (const outcome of outcomes) if (outcome._tag === "Left") assert.ok(outcome.left instanceof PersistenceFailure)
      const replay = await Effect.runPromise(value.service().createDraft(attempt))
      assert.equal(replay.id, [...identifiers][0])
      assert.deepEqual(await counts(value.database.sql), { drafts: 1, lines: 2, idempotency: 1, audits: 1 })
    } finally { await value.close() }
  }
})

void test("one key, a changed payload: refused as reused, with the stored draft untouched", async () => {
  const value = await fixture("conflict")
  try {
    await configure(value)
    const service = value.service()
    const created = await Effect.runPromise(service.createDraft(idempotent("shared", request)))
    const failure = await failureOf(service.createDraft(idempotent("shared", { ...request, notes: "Alt" })))
    assert.ok(failure instanceof DomainConflict)
    assert.equal(failure.code, "idempotency_key_reused")
    assert.deepEqual(await counts(value.database.sql), { drafts: 1, lines: 2, idempotency: 1, audits: 1 })

    // Deleting the draft makes the key a dead end rather than a second chance.
    await Effect.runPromise(service.deleteDraft(created.id))
    const deleted = await failureOf(service.createDraft(idempotent("shared", request)))
    assert.ok(deleted instanceof DomainConflict)
    assert.equal(deleted.code, "draft_creation_result_deleted")
    assert.equal((await counts(value.database.sql)).drafts, 0)
  } finally { await value.close() }
})
