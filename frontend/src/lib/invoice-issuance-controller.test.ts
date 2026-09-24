import assert from "node:assert/strict"
import test from "node:test"

import { createInvoiceIssuanceController } from "./invoice-issuance-controller.ts"
import type { IssuanceClient, IssuanceRequest } from "./invoice-issuance-types.ts"
import { memoryStorage, recoveryHarness, type MemoryStorage } from "./invoice-draft-save-controller.test.ts"
import { ApiFailure } from "./api-errors.ts"
import type { AuthoringDocumentInput, DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"

const issuedInvoice: IssuedInvoice = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-01-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", vatRegistered: true, legalForm: "srl",
    tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca", socialCapital: "100.00",
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  },
  customer: {
    partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  },
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const payload: AuthoringDocumentInput = {
  customer: {
    partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  },
  series: "FCT", issueDate: "2026-01-01", currency: "RON", dueDate: null, notes: null,
  lines: [{ description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }],
}

const draftOf = (status: DraftInvoice["status"]): DraftInvoice => ({
  id: "draft-1", organizationId: "org",
  customer: payload.customer, sourceProformaId: null,
  series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON", notes: null, status,
  lines: payload.lines.map((line, index) => ({
    ...line, id: `line-${String(index + 1)}`, vatRate: "21.00", vatCategoryCode: "S" as const,
    vatExemptionReason: null, totalExcludingVat: line.unitPrice, vatAmount: "0.00", totalIncludingVat: line.unitPrice,
  })),
  vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
})

interface Setup {
  readonly issue: (request: Omit<IssuanceRequest, "blockedMessage"> & { readonly blockedMessage?: string }) => ReturnType<ReturnType<typeof createInvoiceIssuanceController>["issue"]>
  readonly unconfirmedIssue: () => string | undefined
  readonly calls: Array<{ readonly method: string; readonly key: string | undefined }>
  readonly effects: string[]
  readonly session: { owns: boolean; alive: boolean }
  readonly keys: () => number
  readonly storage: MemoryStorage
}

const setup = (
  client: Partial<Record<"getDraft" | "issueDraft" | "issueInvoice", (argument: unknown, key: string) => unknown>>,
  storage: MemoryStorage = memoryStorage(),
): Setup => {
  const calls: Array<{ method: string; key: string | undefined }> = []
  const effects: string[] = []
  const session = { owns: true, alive: true }
  const recovery = recoveryHarness(() => storage)
  const record = (method: string, key: string | undefined): void => { calls.push({ method, key }) }
  const clientAdapter: IssuanceClient = {
    getDraft: (id) => Promise.resolve().then(() => {
      calls.push({ method: "getDraft", key: undefined })
      const handler = client.getDraft
      if (handler === undefined) throw new Error(`unscripted getDraft ${id}`)
      return handler(id, "") as DraftInvoice
    }),
    issueDraft: (_csrfToken, id, idempotencyKey) => Promise.resolve().then(() => {
      record("issueDraft", idempotencyKey)
      const handler = client.issueDraft
      if (handler === undefined) throw new Error(`unscripted issueDraft ${id}`)
      return handler(id, idempotencyKey) as IssuedInvoice
    }),
    issueInvoice: (_csrfToken, body, idempotencyKey) => Promise.resolve().then(() => {
      record("issueInvoice", idempotencyKey)
      const handler = client.issueInvoice
      if (handler === undefined) throw new Error("unscripted issueInvoice")
      return handler(body, idempotencyKey) as IssuedInvoice
    }),
    replayInvoiceIssuance: (_csrfToken, body, idempotencyKey) => Promise.resolve().then(() => {
      record("replayInvoiceIssuance", idempotencyKey)
      const handler = client.issueInvoice
      if (handler === undefined) throw new Error("unscripted replayInvoiceIssuance")
      return handler(body, idempotencyKey) as IssuedInvoice
    }),
  }
  const controller = createInvoiceIssuanceController({
    client: clientAdapter,
    recovery: recovery.port,
    csrfToken: () => "csrf-token",
    epoch: () => 3,
    ownsEpoch: () => session.owns,
    alive: () => session.alive,
    effects: {
      onIssued: (invoice, draftId) => { effects.push(`onIssued:${invoice.id}:${draftId ?? "none"}`) },
      onOutcomeUnknown: (draftId) => { effects.push(`onOutcomeUnknown:${draftId ?? "none"}`) },
    },
  })
  return {
    issue: (request) => controller.issue({ blockedMessage: undefined, ...request }),
    unconfirmedIssue: controller.unconfirmedIssue,
    calls, effects, session, storage, keys: () => recovery.keys().length,
  }
}

void test("a document without a draft is issued directly and its effects run", async () => {
  const world = setup({ issueInvoice: () => issuedInvoice })
  const outcome = await world.issue({ draftId: undefined, payload })
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls, [{ method: "issueInvoice", key: "key-1" }])
  assert.deepEqual(world.effects, ["onIssued:inv-1:none"])
})

void test("a saved draft is read fresh, compared, and only then issued", async () => {
  const world = setup({ getDraft: () => draftOf("draft"), issueDraft: () => issuedInvoice })
  const outcome = await world.issue({ draftId: "draft-1", payload })
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls.map((call) => call.method), ["getDraft", "issueDraft"])
  assert.deepEqual(world.effects, ["onIssued:inv-1:draft-1"])
})

void test("a draft that changed elsewhere is refused before anything is issued", async () => {
  const base = draftOf("draft")
  const first = base.lines[0]
  if (first === undefined) throw new Error("fixture draft needs a line")
  const changed: DraftInvoice = { ...base, lines: [{ ...first, description: "Altceva" }] }
  const world = setup({ getDraft: () => changed })
  const outcome = await world.issue({ draftId: "draft-1", payload })
  assert.equal(outcome.kind, "error")
  assert.deepEqual(world.calls.map((call) => call.method), ["getDraft"])
  assert.deepEqual(world.effects, [])
})

void test("a draft already issued is a replay, not a block: the same key is sent again", async () => {
  const world = setup({ getDraft: () => draftOf("issued"), issueDraft: () => issuedInvoice })
  const outcome = await world.issue({ draftId: "draft-1", payload })
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls.map((call) => call.method), ["getDraft", "issueDraft"])
})

void test("a lost answer keeps the key, so the retry replays the same one", async () => {
  let attempt = 0
  const world = setup({
    issueInvoice: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "pierdut" })
      return issuedInvoice
    },
  })
  const first = await world.issue({ draftId: undefined, payload })
  assert.equal(first.kind, "error")
  const second = await world.issue({ draftId: undefined, payload })
  assert.equal(second.kind, "issued")
  assert.equal(world.calls[0]?.key, world.calls[1]?.key)
})

void test("a settled client error drops the key: the next attempt is a new operation", async () => {
  let attempt = 0
  const world = setup({
    issueInvoice: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "conflict", status: 409 })
      return issuedInvoice
    },
  })
  await world.issue({ draftId: undefined, payload })
  await world.issue({ draftId: undefined, payload })
  assert.notEqual(world.calls[0]?.key, world.calls[1]?.key)
})

void test("an edited payload cannot replay an older answer under the old key", async () => {
  const world = setup({ issueInvoice: () => issuedInvoice })
  await world.issue({ draftId: undefined, payload })
  const firstLine = payload.lines[0]
  if (firstLine === undefined) throw new Error("fixture payload needs a line")
  const edited: AuthoringDocumentInput = {
    ...payload, lines: [...payload.lines, { ...firstLine, description: "Extra" }],
  }
  await world.issue({ draftId: undefined, payload: edited })
  assert.notEqual(world.calls[0]?.key, world.calls[1]?.key)
})

void test("a second click while issuing changes nothing", async () => {
  let release: (() => void) | undefined
  // The handshake, not a tick count: the first request must be observed to have
  // left before it is released, however many awaits the controller takes to
  // reach it. Without it this test deadlocks whenever that path grows a hop.
  let reached: (() => void) | undefined
  const sent = new Promise<void>((resolve) => { reached = resolve })
  const world = setup({
    issueInvoice: () => new Promise<IssuedInvoice>((resolve) => {
      release = () => { resolve(issuedInvoice) }
      reached?.()
    }),
  })
  const first = world.issue({ draftId: undefined, payload })
  const second = await world.issue({ draftId: undefined, payload })
  await sent
  release?.()
  assert.equal((await first).kind, "issued")
  assert.equal(second.kind, "busy")
  assert.equal(world.calls.length, 1)
})

void test("a session that ended before the answer arrives runs no effects and keeps no completion", async () => {
  const world = setup({
    issueInvoice: () => {
      world.session.owns = false
      return issuedInvoice
    },
  })
  const outcome = await world.issue({ draftId: undefined, payload })
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
})

void test("a screen that unmounted runs no effects", async () => {
  const world = setup({
    issueInvoice: () => {
      world.session.alive = false
      return issuedInvoice
    },
  })
  const outcome = await world.issue({ draftId: undefined, payload })
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
})

void test("an issuance blocked by an unknown save outcome sends nothing at all", async () => {
  const world = setup({ issueInvoice: () => issuedInvoice })
  const outcome = await world.issue({
    draftId: undefined, payload, blockedMessage: "Rezultatul salvării nu este confirmat.",
  })
  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message.includes("nu este confirmat"))
  assert.deepEqual(world.calls, [])
  assert.deepEqual(world.effects, [])
  assert.equal(world.keys(), 0)
})

void test("a lost issue keeps the attempt: the same payload replays under the same key and reports the unknown outcome", async () => {
  let attempt = 0
  const world = setup({
    issueInvoice: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "pierdut", status: 502 })
      return issuedInvoice
    },
  })
  const first = await world.issue({ draftId: undefined, payload })
  assert.equal(first.kind, "error")
  assert.equal(world.unconfirmedIssue() !== undefined, true)
  assert.deepEqual(world.effects, ["onOutcomeUnknown:none"])
  const second = await world.issue({ draftId: undefined, payload })
  assert.equal(second.kind, "issued")
  assert.equal(world.calls[0]?.key, world.calls[1]?.key)
  assert.equal(world.unconfirmedIssue(), undefined)
  assert.deepEqual(world.effects, ["onOutcomeUnknown:none", "onIssued:inv-1:none"])
})

void test("a lost issue refuses an edited payload locally: nothing is sent, no second invoice can exist", async () => {
  let attempt = 0
  const world = setup({
    issueInvoice: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "pierdut" })
      return issuedInvoice
    },
  })
  await world.issue({ draftId: undefined, payload })
  const firstLine = payload.lines[0]
  if (firstLine === undefined) throw new Error("fixture payload needs a line")
  const edited: AuthoringDocumentInput = {
    ...payload, lines: [...payload.lines, { ...firstLine, description: "Corectat" }],
  }
  const outcome = await world.issue({ draftId: undefined, payload: edited })
  assert.equal(outcome.kind, "error")
  assert.equal(world.calls.length, 1)
  assert.equal(world.unconfirmedIssue() !== undefined, true)
})

void test("a settled client error clears the lost attempt: an edited payload may issue fresh", async () => {
  let attempt = 0
  const world = setup({
    issueInvoice: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "pierdut" })
      if (attempt === 2) throw new ApiFailure({ message: "conflict", status: 409 })
      return issuedInvoice
    },
  })
  await world.issue({ draftId: undefined, payload })
  assert.equal(world.unconfirmedIssue() !== undefined, true)
  await world.issue({ draftId: undefined, payload })
  assert.equal(world.unconfirmedIssue(), undefined)
  const firstLine = payload.lines[0]
  if (firstLine === undefined) throw new Error("fixture payload needs a line")
  const edited: AuthoringDocumentInput = {
    ...payload, lines: [...payload.lines, { ...firstLine, description: "Corectat" }],
  }
  const outcome = await world.issue({ draftId: undefined, payload: edited })
  assert.equal(outcome.kind, "issued")
  assert.notEqual(world.calls[0]?.key, world.calls[2]?.key)
})

void test("a saved draft whose issue answer was lost replays legitimately when the fresh read says issued", async () => {
  let attempt = 0
  const world = setup({
    getDraft: () => draftOf(attempt === 1 ? "draft" : "issued"),
    issueDraft: () => {
      attempt += 1
      if (attempt === 1) throw new ApiFailure({ message: "pierdut" })
      return issuedInvoice
    },
  })
  const first = await world.issue({ draftId: "draft-1", payload })
  assert.equal(first.kind, "error")
  assert.equal(world.unconfirmedIssue() !== undefined, true)
  assert.deepEqual(world.effects, ["onOutcomeUnknown:draft-1"])
  const second = await world.issue({ draftId: "draft-1", payload })
  assert.equal(second.kind, "issued")
  assert.deepEqual(world.calls.map((call) => call.method), ["getDraft", "issueDraft", "getDraft", "issueDraft"])
  assert.equal(world.calls[1]?.key, world.calls[3]?.key)
})
