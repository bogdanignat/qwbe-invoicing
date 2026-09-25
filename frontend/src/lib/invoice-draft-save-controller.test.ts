import assert from "node:assert/strict"
import test from "node:test"

import { createInvoiceDraftSaveController } from "./invoice-draft-save-controller.ts"
import type { DraftSaveClient, DraftSaveDependencies, SaveOutcome } from "./draft-save-types.ts"
import {
  BLOCKED_CONFLICT, BLOCKED_CORRUPT, BLOCKED_OTHER, BLOCKED_UNAVAILABLE, RECOVERY_SLOT,
  createRecoveryJournal, type JournalStorage, type RecoveryJournal,
} from "./operation-recovery-journal.ts"
import { NOT_HYDRATED, RESOLVE_FAILED, type RecoveryPort } from "./operation-recovery-port.ts"
import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"

const unit = { code: "C62", name: "unitate" }

export const form = (patch: Partial<InvoiceAuthoringForm> = {}): InvoiceAuthoringForm => ({
  buyerMode: "one-time", customerId: "", partyType: "company", name: "Alfa",
  companyTaxIdentifier: "123", individualTaxIdentifier: "", vatRegistered: false,
  countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1, postalCode: "",
  series: "FCT", issueDate: "2026-01-01", dueDate: "", dueDateEdited: false, notes: "",
  ...patch,
})

export const serverLine = (id: string, description: string, unitPrice: string): DraftInvoice["lines"][number] => ({
  id, description, quantity: "1", unitPrice, unitOfMeasure: unit,
  vatRateCode: "RO_STANDARD", vatRate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
  totalExcludingVat: unitPrice, vatAmount: "0.00", totalIncludingVat: unitPrice,
})

export const draftWith = (id: string, lines: ReadonlyArray<DraftInvoice["lines"][number]>, patch: Partial<DraftInvoice> = {}): DraftInvoice => ({
  id, organizationId: "org", customer: {
    partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  }, sourceProformaId: null, series: "FCT", issueDate: "2026-01-01",
  dueDate: null, currency: "RON", notes: null, status: "draft", lines,
  vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
  ...patch,
})

export const editable = (key: string, description: string, unitPrice: string, lineId?: string): EditableInvoiceLine => ({
  key, ...(lineId === undefined ? {} : { lineId }),
  description, quantity: "1", unitPrice, unitOfMeasure: unit, vatRateCode: "RO_STANDARD",
})

export const networkFailure = (): ApiFailure => new ApiFailure({ message: "Conexiunea a eșuat." })

export interface MemoryStorage extends JournalStorage {
  readonly slots: Map<string, string>
  failSet: boolean
  failRemove: boolean
}

/** Session storage, in memory, with the two failures a real browser can hand back. */
export const memoryStorage = (): MemoryStorage => {
  const slots = new Map<string, string>()
  const state = {
    slots,
    failSet: false,
    failRemove: false,
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.failSet) throw new Error("QuotaExceededError")
      slots.set(key, value)
    },
    removeItem: (key: string) => {
      if (state.failRemove) throw new Error("SecurityError")
      slots.delete(key)
    },
  }
  return state
}

export interface RecoveryHarness {
  readonly journal: RecoveryJournal
  readonly port: RecoveryPort
  readonly keys: () => ReadonlyArray<string>
}

export const recoveryHarness = (
  storage: () => JournalStorage | undefined,
  hydrated: { value: boolean } = { value: true },
): RecoveryHarness => {
  const issued: string[] = []
  const journal = createRecoveryJournal({
    storage,
    now: () => "2026-01-01T00:00:00.000Z",
    newKey: () => {
      const key = `key-${String(issued.length + 1)}`
      issued.push(key)
      return key
    },
  })
  return {
    journal,
    port: {
      hydrated: () => hydrated.value,
      claim: journal.claim,
      resolve: journal.resolve,
      markConflict: journal.markConflict,
    },
    keys: () => issued,
  }
}

export interface Harness {
  readonly controller: ReturnType<typeof createInvoiceDraftSaveController>
  readonly calls: Array<{ readonly method: string; readonly args: ReadonlyArray<unknown> }>
  readonly effects: string[]
  readonly session: { owns: boolean; alive: boolean; csrf: string | undefined }
  readonly client: DraftSaveClient & {
    readonly respond: (method: string, handler: (args: ReadonlyArray<unknown>, call: number) => unknown) => void
  }
  readonly storage: MemoryStorage
  readonly recovery: RecoveryHarness
  readonly hydrated: { value: boolean }
}

export interface HarnessOptions {
  readonly storage?: MemoryStorage | undefined
  readonly available?: boolean
  readonly hydrated?: boolean
}

/** A scripted client plus recorded effects, with the session ownership the tests can flip mid-flight. */
export const harness = (
  responses: Record<string, (args: ReadonlyArray<unknown>, call: number) => unknown> = {},
  options: HarnessOptions = {},
): Harness => {
  const storage = options.storage ?? memoryStorage()
  const hydrated = { value: options.hydrated ?? true }
  const recovery = recoveryHarness(() => options.available === false ? undefined : storage, hydrated)
  const calls: Array<{ method: string; args: ReadonlyArray<unknown> }> = []
  const effects: string[] = []
  const session = { owns: true, alive: true, csrf: "csrf-token" }
  const handlers = { ...responses }
  const client: DraftSaveClient = {
    createDraft: async (...args: Parameters<DraftSaveClient["createDraft"]>) => dispatch("createDraft", args),
    replayDraftCreation: async (...args: Parameters<DraftSaveClient["replayDraftCreation"]>) => dispatch("replayDraftCreation", args),
    getDraft: async (...args: Parameters<DraftSaveClient["getDraft"]>) => dispatch("getDraft", args),
    updateDraft: async (...args: Parameters<DraftSaveClient["updateDraft"]>) => dispatch("updateDraft", args),
    addDraftLine: async (...args: Parameters<DraftSaveClient["addDraftLine"]>) => dispatch("addDraftLine", args),
    updateDraftLine: async (...args: Parameters<DraftSaveClient["updateDraftLine"]>) => dispatch("updateDraftLine", args),
    deleteDraftLine: async (...args: Parameters<DraftSaveClient["deleteDraftLine"]>) => dispatch("deleteDraftLine", args),
    deleteDraft: async (...args: Parameters<DraftSaveClient["deleteDraft"]>) => dispatch("deleteDraft", args),
  } as DraftSaveClient
  const counts = new Map<string, number>()
  const dispatch = (method: string, args: ReadonlyArray<unknown>): Promise<unknown> => {
    calls.push({ method, args })
    const count = (counts.get(method) ?? 0) + 1
    counts.set(method, count)
    const handler = handlers[method]
    if (handler === undefined) return Promise.reject(new Error(`unscripted ${method}`))
    return Promise.resolve(handler(args, count))
  }
  const dependencies: DraftSaveDependencies = {
    client,
    csrfToken: () => session.csrf,
    epoch: () => 7,
    ownsEpoch: () => session.owns,
    alive: () => session.alive,
    recovery: recovery.port,
    effects: {
      recordDraft: (value) => { effects.push(`recordDraft:${value.id}`) },
      recordLines: (value) => { effects.push(`recordLines:${value.map((line) => line.key).join(",")}`) },
      removeLine: (key) => { effects.push(`removeLine:${key}`) },
      invalidateDrafts: () => { effects.push("invalidateDrafts") },
      evictDraft: (id) => { effects.push(`evictDraft:${id}`) },
      notify: (message) => { effects.push(`notify:${message}`) },
      navigate: (path) => { effects.push(`navigate:${path}`) },
    },
  }
  return {
    controller: createInvoiceDraftSaveController(dependencies),
    calls, effects, session, storage, recovery, hydrated,
    client: { ...client, respond: (method, handler) => { handlers[method] = handler } },
  }
}

export const outcomeKind = async (promise: Promise<SaveOutcome>): Promise<string> => (await promise).kind

void test("a new document is created whole: one request, no line writes, the server's lines adopted", async () => {
  const withLine = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({ createDraft: () => withLine })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "saved")
  assert.deepEqual(setup.calls.map((call) => call.method), ["createDraft"])
  assert.deepEqual(setup.effects, [
    "recordDraft:draft-1", "recordLines:line-1",
    "invalidateDrafts", "navigate:/drafts/draft-1", "notify:Draftul a fost salvat.",
  ])
})

void test("a second click while the save is in flight changes nothing", async () => {
  let release: (() => void) | undefined
  let reached: (() => void) | undefined
  const sent = new Promise<void>((resolve) => { reached = resolve })
  const setup = harness({
    createDraft: () => new Promise<DraftInvoice>((resolve) => {
      release = () => { resolve(draftWith("draft-1", [])) }
      reached?.()
    }),
  })
  const first = setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  const second = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  await sent
  release?.()
  assert.equal((await first).kind, "saved")
  assert.equal(second.kind, "busy")
  assert.equal(setup.calls.filter((call) => call.method === "createDraft").length, 1)
})

void test("a failed line on a saved draft is the only thing the next save sends again", async () => {
  const withFirst = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const withBoth = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00"), serverLine("line-2", "Suport", "50.00")])
  let failFirstAttempt = true
  const setup = harness({
    addDraftLine: (_args, call) => {
      if (call === 1 && failFirstAttempt) throw new ApiFailure({ message: "invalid", status: 400 })
      return withBoth
    },
  })
  const lines = [editable("k1", "Consultanță", "100.00", "line-1"), editable("k2", "Suport", "50.00")]
  const first = await setup.controller.save({
    draft: withFirst, form: form(), lines, forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(first.kind, "error")
  failFirstAttempt = false
  const second = await setup.controller.save({
    draft: withFirst, form: form(), lines, forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(second.kind, "saved")
  // The saved line is never re-sent: only the one that failed leaves again.
  const lineWrites = setup.calls.filter((call) => call.method === "addDraftLine")
  assert.equal(lineWrites.length, 2)
  assert.deepEqual(lineWrites[1]?.args[2], { description: "Suport", quantity: "1", unitPrice: "50.00", unitOfMeasure: unit, vatRateCode: "RO_STANDARD" })
})

void test("a missing CSRF token fails before anything is sent", async () => {
  const setup = harness({})
  setup.session.csrf = undefined
  await assert.rejects(setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  }))
  assert.deepEqual(setup.calls, [])
})

void test("an unsaved line is the caller's to remove: the controller sends nothing for it", async () => {
  const setup = harness({})
  const outcome = await setup.controller.deleteLine(draftWith("draft-1", []), editable("k1", "Nesalvată", "1.00"))
  assert.equal(outcome.kind, "error")
  assert.deepEqual(setup.calls, [])
  assert.deepEqual(setup.effects, [])
})

void test("deleting a saved line records the server's answer and removes the line locally", async () => {
  const withLine = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({ deleteDraftLine: () => draftWith("draft-1", []) })
  const outcome = await setup.controller.deleteLine(withLine, editable("k1", "Consultanță", "100.00", "line-1"))
  assert.equal(outcome.kind, "saved")
  assert.ok(setup.effects.includes("recordDraft:draft-1"))
  assert.ok(setup.effects.includes("removeLine:k1"))
  assert.ok(setup.effects.includes("notify:Linia a fost ștearsă."))
})

void test("deleting the draft navigates back, evicts its cache entry and refreshes the list", async () => {
  const setup = harness({ deleteDraft: () => undefined })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", []))
  assert.equal(outcome.kind, "saved")
  assert.ok(setup.effects.includes("navigate:/invoices"))
  assert.ok(setup.effects.includes("evictDraft:draft-1"))
  assert.ok(setup.effects.includes("invalidateDrafts"))
})

void test("a derived draft is refused deletion without a request", async () => {
  const setup = harness({ deleteDraft: () => undefined })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", [], { sourceProformaId: "prof-1" }))
  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message.includes("proformă"))
  assert.deepEqual(setup.calls, [])
  assert.deepEqual(setup.effects, [])
})

void test("an issued draft is refused deletion without a request", async () => {
  const setup = harness({ deleteDraft: () => undefined })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", [], { status: "issued" }))
  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message.includes("deja emis"))
  assert.deepEqual(setup.calls, [])
  assert.deepEqual(setup.effects, [])
})

void test("an unknown create blocks every later write, including deletions", async () => {
  const setup = harness({ createDraft: () => { throw networkFailure() } })
  const save = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(save.kind, "unconfirmed")
  const removedDraft = await setup.controller.deleteDraft(draftWith("draft-1", []))
  assert.equal(removedDraft.kind, "unconfirmed")
  const removedLine = await setup.controller.deleteLine(
    draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")]),
    editable("k1", "Consultanță", "100.00", "line-1"),
  )
  assert.equal(removedLine.kind, "unconfirmed")
  assert.equal(setup.calls.filter((call) => call.method === "createDraft").length, 1)
  assert.equal(setup.calls.some((call) => call.method === "deleteDraft" || call.method === "deleteDraftLine"), false)
})

// The recovery branches of `createDraftStep`: what the journal is allowed to
// let through, and what has to stay on disk when the answer is not an answer.

const createRequest = (patch: Partial<InvoiceAuthoringForm> = {}) => ({
  draft: undefined, form: form(patch), lines: [editable("k1", "Consultanță", "100.00")],
  forcedUpdateLineIds: () => [], navigateOnCreate: true,
})

const storedRecord = (storage: MemoryStorage): Record<string, unknown> =>
  JSON.parse(storage.slots.get(RECOVERY_SLOT) ?? "null") as Record<string, unknown>

void test("a journal that has not hydrated yet sends nothing at all", async () => {
  const setup = harness({ createDraft: () => draftWith("draft-1", []) }, { hydrated: false })
  const outcome = await setup.controller.save(createRequest())
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as Error).message, NOT_HYDRATED)
  assert.deepEqual(setup.calls, [])
  assert.equal(setup.storage.slots.size, 0)
})

void test("an unavailable journal blocks the create instead of sending an unrecoverable request", async () => {
  const setup = harness({ createDraft: () => draftWith("draft-1", []) }, { available: false })
  const outcome = await setup.controller.save(createRequest())
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as Error).message, BLOCKED_UNAVAILABLE)
  assert.deepEqual(setup.calls, [])
})

void test("a corrupt journal blocks the create until the user dismisses it", async () => {
  const storage = memoryStorage()
  storage.slots.set(RECOVERY_SLOT, "{ not json")
  const setup = harness({ createDraft: () => draftWith("draft-1", []) }, { storage })
  const outcome = await setup.controller.save(createRequest())
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as Error).message, BLOCKED_CORRUPT)
  assert.deepEqual(setup.calls, [])
})

void test("after a reload the same document replays the stored body under the stored key", async () => {
  const storage = memoryStorage()
  const first = harness({ createDraft: () => { throw networkFailure() } }, { storage })
  assert.equal((await first.controller.save(createRequest())).kind, "unconfirmed")
  const stored = storedRecord(storage)
  assert.equal(stored["state"], "pending")
  assert.equal(stored["key"], "key-1")

  // A fresh controller over the same storage: the reload.
  const created = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const second = harness({ replayDraftCreation: () => created }, { storage })
  const outcome = await second.controller.save(createRequest())
  assert.equal(outcome.kind, "saved")
  assert.deepEqual(second.calls.map((call) => call.method), ["replayDraftCreation"])
  const [, body, key] = second.calls[0]?.args ?? []
  assert.deepEqual(body, (stored["request"] as { readonly body: unknown }).body)
  assert.equal(key, "key-1")
  // The stored request, not the payload the form would build now.
  assert.equal(second.recovery.keys().length, 0)
  assert.equal(storage.slots.size, 0)
})

void test("a different document may not start a second operation while the first is unresolved", async () => {
  const storage = memoryStorage()
  const first = harness({ createDraft: () => { throw networkFailure() } }, { storage })
  assert.equal((await first.controller.save(createRequest())).kind, "unconfirmed")

  const second = harness({ createDraft: () => draftWith("draft-2", []), replayDraftCreation: () => draftWith("draft-2", []) }, { storage })
  const outcome = await second.controller.save(createRequest({ series: "ALT" }))
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as Error).message, BLOCKED_OTHER)
  assert.deepEqual(second.calls, [])
  assert.equal(storedRecord(storage)["key"], "key-1")
})

void test("an issuance intent in the slot blocks a create, and a create intent blocks it back", async () => {
  const storage = memoryStorage()
  const first = harness({ createDraft: () => { throw networkFailure() } }, { storage })
  assert.equal((await first.controller.save(createRequest())).kind, "unconfirmed")
  const stored = storedRecord(storage)
  assert.equal(stored["operation"], "create-draft")
  // Cross-operation: the slot is one per tab, so the other write is refused by
  // the same rule that refuses a different document.
  // A whole record of the other operation, request included: the decoder now
  // refuses a pair whose two halves disagree, and this must be refused by the
  // slot rule, not by decoding.
  storage.slots.set(RECOVERY_SLOT, JSON.stringify({
    ...stored, operation: "issue-invoice", request: { kind: "issue-draft", draftId: "draft-1" },
  }))
  const second = harness({ createDraft: () => draftWith("draft-2", []) }, { storage })
  const outcome = await second.controller.save(createRequest())
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as Error).message, BLOCKED_OTHER)
  assert.deepEqual(second.calls, [])
})

void test("a 409 on a spent key is kept as evidence: no rotation, no retry", async () => {
  const storage = memoryStorage()
  const setup = harness({
    createDraft: () => { throw new ApiFailure({ message: "conflict", status: 409, code: "idempotency_key_reused" }) },
  }, { storage })
  const outcome = await setup.controller.save(createRequest())
  assert.equal(outcome.kind, "error")
  assert.equal((outcome.error as ApiFailure).code, "idempotency_key_reused")
  const stored = storedRecord(storage)
  assert.equal(stored["state"], "conflict")
  assert.equal(stored["conflict"], "idempotency_key_reused")
  assert.equal(stored["key"], "key-1")
  assert.equal(setup.recovery.keys().length, 1)

  // A second attempt — new controller, same tab — sends nothing.
  const again = harness({ createDraft: () => draftWith("draft-1", []) }, { storage })
  const blocked = await again.controller.save(createRequest())
  assert.equal(blocked.kind, "error")
  assert.equal((blocked.error as Error).message, BLOCKED_CONFLICT)
  assert.deepEqual(again.calls, [])
  assert.equal(again.recovery.keys().length, 0)
})

void test("a deleted create result is the same spent key: conflict, dismissible, never recreated", async () => {
  const storage = memoryStorage()
  const setup = harness({
    createDraft: () => { throw new ApiFailure({ message: "conflict", status: 409, code: "draft_creation_result_deleted" }) },
  }, { storage })
  assert.equal((await setup.controller.save(createRequest())).kind, "error")
  assert.equal(storedRecord(storage)["conflict"], "draft_creation_result_deleted")
  assert.equal(setup.recovery.keys().length, 1)
})

void test("a definitive 4xx frees the slot, and the next attempt gets a new key", async () => {
  const setup = harness({
    createDraft: (_arguments, call) => {
      if (call === 1) throw new ApiFailure({ message: "Seria este invalidă.", status: 400 })
      return draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
    },
  })
  const first = await setup.controller.save(createRequest())
  assert.equal(first.kind, "error")
  assert.equal(setup.storage.slots.size, 0)

  const second = await setup.controller.save(createRequest())
  assert.equal(second.kind, "saved")
  assert.deepEqual(setup.calls.map((call) => call.method), ["createDraft", "createDraft"])
  assert.equal(setup.calls[1]?.args[2], "key-2")
  assert.deepEqual(setup.recovery.keys(), ["key-1", "key-2"])
})

void test("a storage that refuses to forget a finished create says so instead of claiming a clean save", async () => {
  const storage = memoryStorage()
  const setup = harness({ createDraft: () => draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")]) }, { storage })
  storage.failRemove = true
  const outcome = await setup.controller.save(createRequest())
  assert.equal(outcome.kind, "saved")
  assert.ok(setup.effects.includes(`notify:${RESOLVE_FAILED}`))
})
