import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { memoryStorage, recoveryHarness, type MemoryStorage } from "./invoice-draft-save-controller.test.ts"
import { decodeJournalEntry } from "./operation-recovery-types.ts"
import { RECOVERY_SLOT } from "./operation-recovery-journal.ts"
import { CONVERSION_DUE_DATE_ISSUE } from "./proforma-conversion.ts"
import { createProformaConversionController } from "./proforma-conversion-controller.ts"
import {
  ALREADY_CONVERTED, UNCONFIRMED_CONVERSION, UNCONFIRMED_CONVERSION_CHANGED,
  type ConversionClient, type ConversionRequest,
} from "./proforma-conversion-types.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

const address = { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 }

const invoice: IssuedInvoice = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-02-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", vatRegistered: true, legalForm: "srl",
    tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca",
    socialCapital: "100.00", address,
  },
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false, address },
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const draft: DraftInvoice = {
  id: "draft-1", organizationId: "org", sourceProformaId: "prf-1", status: "draft",
  customer: invoice.customer, series: "FCT", issueDate: "2026-02-01", dueDate: null, currency: "RON", notes: null,
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const summary = { buyerName: "Alfa", series: "FCT", issueDate: "2026-02-01", lineCount: 1 }

type Handler = (body: unknown, key: string) => unknown

interface Setup {
  readonly convert: (request: Omit<ConversionRequest, "summary" | "blockedMessage" | "dueDate" | "totalIncludingVat"> & {
    readonly summary?: ConversionRequest["summary"]
    readonly blockedMessage?: string
    readonly dueDate?: string | null
    readonly totalIncludingVat?: string
  }) => ReturnType<ReturnType<typeof createProformaConversionController>["convert"]>
  readonly unconfirmed: () => string | undefined
  readonly calls: Array<{ readonly method: string; readonly key: string; readonly body: unknown }>
  readonly effects: string[]
  readonly session: { owns: boolean; alive: boolean }
  readonly storage: MemoryStorage
  readonly keys: () => number
}

const setup = (
  client: Partial<Record<"invoice" | "draft" | "replayInvoice" | "replayDraft", Handler>>,
  storage: MemoryStorage = memoryStorage(),
  hydrated: { value: boolean } = { value: true },
): Setup => {
  const calls: Array<{ method: string; key: string; body: unknown }> = []
  const effects: string[] = []
  const session = { owns: true, alive: true }
  const recovery = recoveryHarness(() => storage, hydrated)
  const run = (method: string, handler: Handler | undefined, body: unknown, key: string): unknown =>
    Promise.resolve().then(() => {
      calls.push({ method, key, body })
      if (handler === undefined) throw new Error(`unscripted ${method}`)
      return handler(body, key)
    })
  const adapter: ConversionClient = {
    convertToInvoice: (_csrf, _id, invoiceSeries, key) =>
      run("convertToInvoice", client.invoice, { invoiceSeries }, key) as Promise<IssuedInvoice>,
    convertToDraft: (_csrf, _id, invoiceSeries, key) =>
      run("convertToDraft", client.draft, { invoiceSeries }, key) as Promise<DraftInvoice>,
    replayInvoiceFromProforma: (_csrf, _id, body, key) =>
      run("replayInvoiceFromProforma", client.replayInvoice, body, key) as Promise<IssuedInvoice>,
    replayDraftFromProforma: (_csrf, _id, body, key) =>
      run("replayDraftFromProforma", client.replayDraft, body, key) as Promise<DraftInvoice>,
  }
  const controller = createProformaConversionController({
    client: adapter,
    recovery: recovery.port,
    csrfToken: () => "csrf-token",
    epoch: () => 3,
    ownsEpoch: () => session.owns,
    alive: () => session.alive,
    effects: {
      onConverted: (result, proformaId) => {
        effects.push(`onConverted:${result.kind}:${result.kind === "invoice" ? result.invoice.id : result.draft.id}:${proformaId}`)
      },
      onOutcomeUnknown: (proformaId) => { effects.push(`onOutcomeUnknown:${proformaId}`) },
      onAlreadyConverted: (proformaId) => { effects.push(`onAlreadyConverted:${proformaId}`) },
    },
  })
  return {
    convert: (request) => controller.convert({
      summary, blockedMessage: undefined, dueDate: "2026-03-01", totalIncludingVat: "119.00", ...request,
    }),
    unconfirmed: controller.unconfirmedConversion,
    calls, effects, session, storage, keys: () => recovery.keys().length,
  }
}

const request = { target: "invoice", proformaId: "prf-1", invoiceSeries: "FCT" } as const
const stored = (world: Setup) => decodeJournalEntry(world.storage.getItem(RECOVERY_SLOT))

void test("an invoice conversion sends the chosen series under the claimed key and runs its effects", async () => {
  const world = setup({ invoice: () => invoice })
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "converted")
  assert.deepEqual(world.calls, [{ method: "convertToInvoice", key: "key-1", body: { invoiceSeries: "FCT" } }])
  assert.deepEqual(world.effects, ["onConverted:invoice:inv-1:prf-1"])
  // Settled: the slot is free for the next operation.
  assert.equal(stored(world).kind, "empty")
})

void test("a draft conversion is its own operation, recorded as such before the request leaves", async () => {
  const world = setup({
    draft: () => {
      assert.equal(stored(world).kind, "record")
      return draft
    },
  })
  const outcome = await world.convert({ ...request, target: "draft" })

  assert.equal(outcome.kind, "converted")
  assert.deepEqual(world.calls.map((call) => call.method), ["convertToDraft"])
  assert.deepEqual(world.effects, ["onConverted:draft:draft-1:prf-1"])
})

void test("the journal records the operation, the path id and the body, and nothing else", async () => {
  const world = setup({
    draft: () => {
      const entry = stored(world)
      assert.equal(entry.kind === "record" ? entry.record.operation : "", "convert-proforma-draft")
      assert.deepEqual(entry.kind === "record" ? entry.record.request : undefined, {
        kind: "convert-proforma-draft", proformaId: "prf-1", body: { invoiceSeries: "FCT" },
      })
      assert.deepEqual(entry.kind === "record" ? entry.record.summary : undefined, summary)
      return draft
    },
  })

  assert.equal((await world.convert({ ...request, target: "draft" })).kind, "converted")
})

void test("nothing is sent before the journal has hydrated", async () => {
  const world = setup({ invoice: () => invoice }, memoryStorage(), { value: false })
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "error")
  assert.deepEqual(world.calls, [])
  assert.equal(world.keys(), 0)
})

void test("a message the screen already carries refuses the conversion before any request", async () => {
  const world = setup({ invoice: () => invoice })
  const outcome = await world.convert({ ...request, blockedMessage: "Verifică registrul." })

  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message === "Verifică registrul.")
  assert.deepEqual(world.calls, [])
})

void test("a lost answer keeps the key, warns, and replays the stored body on the next press", async () => {
  let attempt = 0
  const world = setup({
    invoice: () => {
      attempt += 1
      if (attempt === 1) throw new UnreadableAnswer(new Error("body illisible"))
      return invoice
    },
    replayInvoice: () => invoice,
  })
  const first = await world.convert(request)

  assert.equal(first.kind, "error")
  assert.deepEqual(world.effects, ["onOutcomeUnknown:prf-1"])
  assert.equal(world.unconfirmed(), UNCONFIRMED_CONVERSION)
  assert.equal(stored(world).kind, "record")

  const second = await world.convert(request)

  assert.equal(second.kind, "converted")
  // The same key, through the replay endpoint, with the body that was stored.
  assert.deepEqual(world.calls[1], {
    method: "replayInvoiceFromProforma", key: "key-1", body: { invoiceSeries: "FCT" },
  })
  assert.equal(world.keys(), 1)
  assert.equal(world.unconfirmed(), undefined)
})

void test("after a lost answer a different series is refused instead of sent under the spent key", async () => {
  const world = setup({ invoice: () => { throw new ApiFailure({ message: "gateway", status: 504 }) } })

  assert.equal((await world.convert(request)).kind, "error")
  const second = await world.convert({ ...request, invoiceSeries: "FCT2" })

  assert.equal(second.kind === "error" && second.error instanceof Error ? second.error.message : "", UNCONFIRMED_CONVERSION_CHANGED)
  assert.equal(world.calls.length, 1)
})

/**
 * The other target under an unresolved intent: the journal itself refuses it,
 * because the stored operation names the document that was asked for and a
 * "make me a draft" answer must never settle "make me an invoice".
 */
void test("the other conversion is refused while the first one is unresolved", async () => {
  const world = setup({ invoice: () => { throw new ApiFailure({ message: "gateway", status: 503 }) } })

  assert.equal((await world.convert(request)).kind, "error")
  const other = await world.convert({ ...request, target: "draft" })

  assert.equal(other.kind, "error")
  assert.equal(world.calls.length, 1)
  assert.equal(world.keys(), 1)
})

void test("a settled refusal frees the key, so a corrected request is a new operation", async () => {
  const world = setup({
    invoice: () => { throw new ApiFailure({ message: "Seria nu există.", status: 400 }) },
    draft: () => draft,
  })
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "error")
  assert.equal(world.unconfirmed(), undefined)
  assert.equal(stored(world).kind, "empty")

  assert.equal((await world.convert({ ...request, target: "draft" })).kind, "converted")
  assert.equal(world.keys(), 2)
})

/**
 * The server answers a second conversion with `proforma_already_converted`, and
 * that is a fact about the document, not a failure of this attempt: retrying
 * only collects the same 409. The key is settled, the screen is told to re-read
 * the proforma, and the outcome carries the state rather than an error.
 */
void test("a proforma the server says is already converted ends as a state, not as a failure", async () => {
  const world = setup({
    invoice: () => {
      throw new ApiFailure({
        message: "Proforma was already converted", status: 409, code: "proforma_already_converted",
      })
    },
  })
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "already-converted")
  assert.equal(outcome.message, ALREADY_CONVERTED)
  assert.deepEqual(world.effects, ["onAlreadyConverted:prf-1"])
  // Settled, not held as evidence: nothing is unresolved, and nothing is replayed.
  assert.equal(stored(world).kind, "empty")
  assert.equal(world.unconfirmed(), undefined)
})

/**
 * The rule lives at the seam that sends the request, so a caller that carries no
 * `blockedMessage` of its own — a replay, another screen, a later refactor —
 * still cannot seal an invoice the server would date today with no due date.
 */
void test("a positive proforma without a due date cannot be converted into an invoice by any caller", async () => {
  const world = setup({ invoice: () => invoice, draft: () => draft })
  const outcome = await world.convert({ ...request, dueDate: null, totalIncludingVat: "119.00" })

  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message === CONVERSION_DUE_DATE_ISSUE)
  assert.equal(world.calls.length, 0)
  assert.equal(world.keys(), 0)

  // The draft route is exactly what the rule leaves open: the due date is filled in there.
  const draftOutcome = await world.convert({ ...request, target: "draft", dueDate: null, totalIncludingVat: "119.00" })

  assert.equal(draftOutcome.kind, "converted")
  assert.deepEqual(world.calls.map((call) => call.method), ["convertToDraft"])
})

void test("a proforma with nothing owed is issuable without a due date", async () => {
  const world = setup({ invoice: () => invoice })
  const outcome = await world.convert({ ...request, dueDate: null, totalIncludingVat: "0.00" })

  assert.equal(outcome.kind, "converted")
})

void test("a key the server says is spent is kept as evidence, not retried", async () => {
  const world = setup({
    invoice: () => { throw new ApiFailure({ message: "cheie", status: 409, code: "idempotency_key_reused" }) },
  })

  assert.equal((await world.convert(request)).kind, "error")
  const entry = stored(world)
  assert.equal(entry.kind === "record" ? entry.record.state : "", "conflict")
  assert.equal(entry.kind === "record" ? entry.record.conflict : "", "idempotency_key_reused")
  // Nothing new may be claimed while that evidence stands.
  assert.equal((await world.convert(request)).kind, "error")
  assert.equal(world.calls.length, 1)
})

void test("an answer for a session that ended is neither adopted nor followed", async () => {
  const world = setup({
    invoice: () => {
      world.session.owns = false
      return invoice
    },
  })
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
})

void test("a confirmed conversion whose follow-up failed stays confirmed", async () => {
  const storage = memoryStorage()
  const world = setup({ invoice: () => invoice }, storage)
  storage.failRemove = true
  const outcome = await world.convert(request)

  assert.equal(outcome.kind, "converted")
  assert.ok(outcome.effectsError instanceof Error)
  assert.deepEqual(world.effects, ["onConverted:invoice:inv-1:prf-1"])
})
