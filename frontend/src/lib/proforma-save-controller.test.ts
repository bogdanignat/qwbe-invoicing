import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { memoryStorage, recoveryHarness, type MemoryStorage } from "./invoice-draft-save-controller.test.ts"
import { decodeJournalEntry } from "./operation-recovery-types.ts"
import { RECOVERY_SLOT } from "./operation-recovery-journal.ts"
import type { AuthoringProformaInput } from "./proforma-models.ts"
import { createProformaSaveController } from "./proforma-save-controller.ts"
import {
  UNCONFIRMED_PROFORMA, UNCONFIRMED_PROFORMA_EDITED, type ProformaSaveClient,
} from "./proforma-save-types.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

const payload: AuthoringProformaInput = {
  customer: {
    partyType: "company", name: "Alfa SRL", fiscalIdentifier: "87654329", vatRegistered: true,
    address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Scurtă 2", county: "RO-CJ" },
  },
  proformaSeries: "PRO", issueDate: "2026-02-01", dueDate: "2026-02-15", currency: "RON", notes: null,
  lines: [{
    description: "Avans", quantity: "2", unitPrice: "500.00",
    unitOfMeasure: { code: "H87", name: "bucată" }, vatRateCode: "RO_STANDARD",
  }],
}

type Handler = (body: unknown, key: string) => unknown

const setup = (
  client: Partial<Record<"create" | "replay", Handler>>,
  storage: MemoryStorage = memoryStorage(),
  hydrated: { value: boolean } = { value: true },
) => {
  const calls: Array<{ method: string; key: string; body: unknown }> = []
  const effects: string[] = []
  const session = { owns: true, alive: true }
  const recovery = recoveryHarness(() => storage, hydrated)
  const run = (method: string, handler: Handler | undefined, body: unknown, key: string) =>
    Promise.resolve().then(() => {
      calls.push({ method, key, body })
      if (handler === undefined) throw new Error(`unscripted ${method}`)
      return handler(body, key) as { readonly id: string }
    })
  const adapter: ProformaSaveClient = {
    createProforma: (_csrf, body, key) => run("createProforma", client.create, body, key),
    replayProformaIssuance: (_csrf, body, key) => run("replayProformaIssuance", client.replay, body, key),
  }
  const controller = createProformaSaveController({
    client: adapter,
    recovery: recovery.port,
    csrfToken: () => "csrf-token",
    epoch: () => 5,
    ownsEpoch: () => session.owns,
    alive: () => session.alive,
    effects: {
      onSaved: (proforma) => { effects.push(`onSaved:${proforma.id}`) },
      onOutcomeUnknown: () => { effects.push("onOutcomeUnknown") },
    },
  })
  return { controller, calls, effects, session, storage, keys: () => recovery.keys().length }
}

const stored = (storage: MemoryStorage) => decodeJournalEntry(storage.getItem(RECOVERY_SLOT))

void test("the proforma is sent under the key the journal recorded first, then the slot is freed", async () => {
  const world = setup({
    create: () => {
      // The record exists before the request leaves: that is the whole point.
      assert.equal(stored(world.storage).kind, "record")
      return { id: "prf-1" }
    },
  })
  const outcome = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(outcome.kind, "saved")
  assert.deepEqual(world.calls.map((call) => ({ method: call.method, key: call.key })), [
    { method: "createProforma", key: "key-1" },
  ])
  assert.deepEqual(world.effects, ["onSaved:prf-1"])
  assert.equal(stored(world.storage).kind, "empty")
})

void test("the journal record names the operation and stores the body that was sent", async () => {
  const world = setup({
    create: () => {
      const entry = stored(world.storage)
      assert.equal(entry.kind === "record" ? entry.record.operation : "", "create-proforma")
      assert.deepEqual(entry.kind === "record" ? entry.record.request : undefined, {
        kind: "create-proforma", body: payload,
      })
      assert.deepEqual(entry.kind === "record" ? entry.record.summary : undefined, {
        buyerName: "Alfa SRL", series: "PRO", issueDate: "2026-02-01", lineCount: 1,
      })
      return { id: "prf-1" }
    },
  })

  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "saved")
})

void test("nothing is sent before the journal has hydrated", async () => {
  const world = setup({ create: () => ({ id: "prf-1" }) }, memoryStorage(), { value: false })
  const outcome = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(outcome.kind, "error")
  assert.deepEqual(world.calls, [])
  assert.equal(world.keys(), 0)
})

void test("a message the screen already carries refuses the save before any request", async () => {
  const world = setup({ create: () => ({ id: "prf-1" }) })
  const outcome = await world.controller.save({ payload, blockedMessage: "Verifică registrul." })

  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message === "Verifică registrul.")
  assert.deepEqual(world.calls, [])
})

void test("a lost answer keeps the key, warns, and replays the stored body on the next press", async () => {
  let attempt = 0
  const world = setup({
    create: () => {
      attempt += 1
      if (attempt === 1) throw new UnreadableAnswer(new Error("body illisible"))
      return { id: "prf-1" }
    },
    replay: () => ({ id: "prf-1" }),
  })
  const first = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(first.kind, "error")
  assert.deepEqual(world.effects, ["onOutcomeUnknown"])
  assert.equal(world.controller.unconfirmedSave(), UNCONFIRMED_PROFORMA)
  assert.equal(stored(world.storage).kind, "record")

  const second = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(second.kind, "saved")
  assert.deepEqual(world.calls[1], { method: "replayProformaIssuance", key: "key-1", body: payload })
  assert.equal(world.keys(), 1)
  assert.equal(world.controller.unconfirmedSave(), undefined)
})

/**
 * The document that left owns the key. An edited one may not borrow it — the
 * server would answer with the first proforma — and it may not take a fresh one
 * either, because that authors a second document with its own number.
 */
void test("after a lost answer an edited document is refused instead of sent", async () => {
  const world = setup({ create: () => { throw new ApiFailure({ message: "gateway", status: 504 }) } })

  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "error")
  const second = await world.controller.save({
    payload: { ...payload, notes: "adăugat după" }, blockedMessage: undefined,
  })

  assert.equal(second.kind === "error" && second.error instanceof Error ? second.error.message : "", UNCONFIRMED_PROFORMA_EDITED)
  assert.equal(world.calls.length, 1)
})

void test("a settled refusal frees the key, so a corrected document is a new operation", async () => {
  let attempt = 0
  const world = setup({
    create: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "Seria nu există.", status: 422 })
      return { id: "prf-2" }
    },
  })

  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "error")
  assert.equal(world.controller.unconfirmedSave(), undefined)
  assert.equal(stored(world.storage).kind, "empty")

  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "saved")
  assert.equal(world.keys(), 2)
})

void test("a key the server says is spent is kept as evidence, not retried", async () => {
  const world = setup({
    create: () => { throw new ApiFailure({ message: "cheie", status: 409, code: "idempotency_key_reused" }) },
  })

  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "error")
  const entry = stored(world.storage)
  assert.equal(entry.kind === "record" ? entry.record.state : "", "conflict")
  // Nothing new may be claimed while that evidence stands.
  assert.equal((await world.controller.save({ payload, blockedMessage: undefined })).kind, "error")
  assert.equal(world.calls.length, 1)
})

void test("an answer for a session that ended is neither adopted nor followed", async () => {
  const world = setup({
    create: () => {
      world.session.owns = false
      return { id: "prf-1" }
    },
  })
  const outcome = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
})

void test("a confirmed proforma whose follow-up failed stays confirmed", async () => {
  const storage = memoryStorage()
  const world = setup({ create: () => ({ id: "prf-1" }) }, storage)
  storage.failRemove = true
  const outcome = await world.controller.save({ payload, blockedMessage: undefined })

  assert.equal(outcome.kind, "saved")
  assert.ok(outcome.effectsError instanceof Error)
  assert.deepEqual(world.effects, ["onSaved:prf-1"])
})
