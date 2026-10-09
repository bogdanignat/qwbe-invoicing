import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createCorrectionIssuanceController } from "./correction-issuance-controller.ts"
import {
  ALREADY_CORRECTED, UNCONFIRMED_CORRECTION, UNCONFIRMED_CORRECTION_CHANGED, type CorrectionClient,
} from "./correction-issuance-types.ts"
import type { CorrectionDocument } from "./document-snapshot.ts"
import { memoryStorage, recoveryHarness, type MemoryStorage } from "./invoice-draft-save-controller.test.ts"
import { RECOVERY_SLOT } from "./operation-recovery-journal.ts"
import { decodeJournalEntry } from "./operation-recovery-types.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

const address = { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 }

const correction: CorrectionDocument = {
  id: "cor-1", originalInvoiceId: "inv-1", reason: "Anulare", series: "FCT", number: 13, issueDate: "2026-10-09",
  currency: "RON",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", vatRegistered: true, legalForm: "srl",
    tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca",
    socialCapital: "100.00", address,
  },
  customer: { partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false, address },
  lines: [], vatBreakdown: [], totalExcludingVat: "-100.00", vatTotal: "-21.00", totalIncludingVat: "-121.00",
}

const summary = { buyerName: "Alfa", series: "FCT", issueDate: "2026-10-09", lineCount: 1 }
const body = { reason: "Anulare", issueDate: "2026-10-09" }

type Handler = (body: unknown, key: string) => unknown

const setup = (
  client: Partial<Record<"create" | "replay", Handler>>,
  storage: MemoryStorage = memoryStorage(),
) => {
  const calls: Array<{ readonly method: string; readonly key: string; readonly body: unknown }> = []
  const effects: string[] = []
  const recovery = recoveryHarness(() => storage)
  const run = (method: string, handler: Handler | undefined, sent: unknown, key: string): Promise<CorrectionDocument> =>
    Promise.resolve().then(() => {
      calls.push({ method, key, body: sent })
      if (handler === undefined) throw new Error(`unscripted ${method}`)
      return handler(sent, key) as CorrectionDocument
    })
  const adapter: CorrectionClient = {
    createCorrection: (_csrf, invoiceId, sent, key) => run(`create:${invoiceId}`, client.create, sent, key),
    replayCorrection: (_csrf, invoiceId, sent, key) => run(`replay:${invoiceId}`, client.replay, sent, key),
  }
  const controller = createCorrectionIssuanceController({
    client: adapter,
    recovery: recovery.port,
    csrfToken: () => "csrf-token",
    epoch: () => 3,
    ownsEpoch: () => true,
    alive: () => true,
    effects: {
      onIssued: (issued, invoiceId) => { effects.push(`onIssued:${issued.id}:${invoiceId}`) },
      onOutcomeUnknown: (invoiceId) => { effects.push(`onOutcomeUnknown:${invoiceId}`) },
      onAlreadyCorrected: (invoiceId) => { effects.push(`onAlreadyCorrected:${invoiceId}`) },
    },
  })
  return {
    issue: (overrides: { readonly reason?: string; readonly blockedMessage?: string } = {}) => controller.issue({
      invoiceId: "inv-1", summary, blockedMessage: overrides.blockedMessage,
      body: { ...body, ...(overrides.reason === undefined ? {} : { reason: overrides.reason }) },
    }),
    unconfirmed: controller.unconfirmedIssue,
    stored: () => decodeJournalEntry(storage.getItem(RECOVERY_SLOT)),
    calls, effects, keys: () => recovery.keys().length,
  }
}

void test("a storno is written down before it leaves, sent under that key, and settled on success", async () => {
  const world = setup({
    create: () => {
      const entry = world.stored()
      assert.equal(entry.kind, "record")
      assert.deepEqual(entry.record.request, { kind: "create-correction", invoiceId: "inv-1", body })
      assert.equal(entry.record.operation, "create-correction")
      return correction
    },
  })
  const outcome = await world.issue()

  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls, [{ method: "create:inv-1", key: "key-1", body }])
  assert.deepEqual(world.effects, ["onIssued:cor-1:inv-1"])
  assert.equal(world.stored().kind, "empty")
})

void test("a message the screen already carries refuses the storno before any request", async () => {
  const world = setup({ create: () => correction })
  const outcome = await world.issue({ blockedMessage: "Verifică registrul." })

  assert.equal(outcome.kind === "error" && outcome.error instanceof Error ? outcome.error.message : "", "Verifică registrul.")
  assert.deepEqual(world.calls, [])
  assert.equal(world.keys(), 0)
})

void test("a lost answer keeps the key, warns, and replays the stored body on the next press", async () => {
  const world = setup({
    create: () => { throw new UnreadableAnswer(new Error("body illisible")) },
    replay: () => correction,
  })
  const first = await world.issue()

  assert.equal(first.kind, "error")
  assert.deepEqual(world.effects, ["onOutcomeUnknown:inv-1"])
  assert.equal(world.unconfirmed(), UNCONFIRMED_CORRECTION)
  assert.equal(world.stored().kind, "record")

  const second = await world.issue()

  assert.equal(second.kind, "issued")
  assert.deepEqual(world.calls[1], { method: "replay:inv-1", key: "key-1", body })
  assert.equal(world.keys(), 1)
  assert.equal(world.unconfirmed(), undefined)
})

void test("after a lost answer a changed reason is refused instead of sent under the spent key", async () => {
  const world = setup({ create: () => { throw new ApiFailure({ message: "gateway", status: 504 }) } })

  assert.equal((await world.issue()).kind, "error")
  const second = await world.issue({ reason: "Alt motiv" })

  assert.equal(second.kind === "error" && second.error instanceof Error ? second.error.message : "", UNCONFIRMED_CORRECTION_CHANGED)
  assert.equal(world.calls.length, 1)
})

void test("an invoice the server says is already corrected ends as a state, with the key settled", async () => {
  const world = setup({
    create: () => {
      throw new ApiFailure({ message: "An invoice can have only one full correction document", status: 409, code: "invoice_already_corrected" })
    },
  })
  const outcome = await world.issue()

  assert.equal(outcome.kind, "already-corrected")
  assert.equal(outcome.message, ALREADY_CORRECTED)
  assert.deepEqual(world.effects, ["onAlreadyCorrected:inv-1"])
  assert.equal(world.stored().kind, "empty")
  assert.equal(world.unconfirmed(), undefined)
})

void test("a key the server says is spent is kept as evidence, not retried", async () => {
  const world = setup({
    create: () => { throw new ApiFailure({ message: "cheie", status: 409, code: "idempotency_key_reused" }) },
  })

  assert.equal((await world.issue()).kind, "error")
  const entry = world.stored()
  assert.equal(entry.kind === "record" ? entry.record.state : "", "conflict")
  assert.equal(entry.kind === "record" ? entry.record.conflict : "", "idempotency_key_reused")
  assert.equal((await world.issue()).kind, "error")
  assert.equal(world.calls.length, 1)
})

void test("a second press while the first storno is in flight sends nothing", async () => {
  let release: (value: CorrectionDocument) => void = () => undefined
  const world = setup({ create: () => new Promise<CorrectionDocument>((resolve) => { release = resolve }) })
  const first = world.issue()
  const second = await world.issue()

  assert.equal(second.kind, "busy")
  await Promise.resolve()
  release(correction)
  assert.equal((await first).kind, "issued")
  assert.equal(world.calls.length, 1)
})
