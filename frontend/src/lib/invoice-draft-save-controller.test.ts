import assert from "node:assert/strict"
import test from "node:test"

import { createInvoiceDraftSaveController } from "./invoice-draft-save-controller.ts"
import type { DraftSaveClient, DraftSaveDependencies, SaveOutcome } from "./draft-save-types.ts"
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

export interface Harness {
  readonly controller: ReturnType<typeof createInvoiceDraftSaveController>
  readonly calls: Array<{ readonly method: string; readonly args: ReadonlyArray<unknown> }>
  readonly effects: string[]
  readonly session: { owns: boolean; alive: boolean; csrf: string | undefined }
  readonly client: DraftSaveClient & {
    readonly respond: (method: string, handler: (args: ReadonlyArray<unknown>, call: number) => unknown) => void
  }
}

/** A scripted client plus recorded effects, with the session ownership the tests can flip mid-flight. */
export const harness = (responses: Record<string, (args: ReadonlyArray<unknown>, call: number) => unknown> = {}): Harness => {
  const calls: Array<{ method: string; args: ReadonlyArray<unknown> }> = []
  const effects: string[] = []
  const session = { owns: true, alive: true, csrf: "csrf-token" }
  const handlers = { ...responses }
  const client: DraftSaveClient = {
    createDraft: async (...args: Parameters<DraftSaveClient["createDraft"]>) => dispatch("createDraft", args),
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
    calls, effects, session,
    client: { ...client, respond: (method, handler) => { handlers[method] = handler } },
  }
}

export const outcomeKind = async (promise: Promise<SaveOutcome>): Promise<string> => (await promise).kind

void test("a new document saves create, then each line, and moves to the draft's URL", async () => {
  const created = draftWith("draft-1", [])
  const withLine = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({
    createDraft: () => created,
    addDraftLine: () => withLine,
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "saved")
  assert.deepEqual(setup.calls.map((call) => call.method), ["createDraft", "addDraftLine"])
  assert.deepEqual(setup.effects, [
    "recordDraft:draft-1", "recordDraft:draft-1", "recordLines:line-1",
    "invalidateDrafts", "navigate:/drafts/draft-1", "notify:Toate modificările draftului au fost salvate.",
  ])
})

void test("a second click while the save is in flight changes nothing", async () => {
  let release: (() => void) | undefined
  const setup = harness({
    createDraft: () => new Promise<DraftInvoice>((resolve) => { release = () => { resolve(draftWith("draft-1", [])) } }),
  })
  const first = setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  const second = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  release?.()
  assert.equal((await first).kind, "saved")
  assert.equal(second.kind, "busy")
  assert.equal(setup.calls.filter((call) => call.method === "createDraft").length, 1)
})

void test("a failed line leaves the draft retained and the next save sends only what is left", async () => {
  const withFirst = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const withBoth = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00"), serverLine("line-2", "Suport", "50.00")])
  let failSecond = true
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: (_args, call) => {
      if (call === 2 && failSecond) throw new ApiFailure({ message: "invalid", status: 400 })
      return call === 1 ? withFirst : withBoth
    },
  })
  const lines = [editable("k1", "Consultanță", "100.00"), editable("k2", "Suport", "50.00")]
  const first = await setup.controller.save({
    draft: undefined, form: form(), lines, forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(first.kind, "error")
  assert.equal(setup.effects.includes("navigate:/drafts/draft-1"), false)
  const retained = [editable("k1", "Consultanță", "100.00", "line-1"), editable("k2", "Suport", "50.00")]
  failSecond = false
  const second = await setup.controller.save({
    draft: withFirst, form: form(), lines: retained, forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(second.kind, "saved")
  // Two writes failed over in the first save; the resume added exactly one.
  const lineWrites = setup.calls.filter((call) => call.method === "addDraftLine")
  assert.equal(lineWrites.length, 3)
  assert.deepEqual(lineWrites[2]?.args[2], { description: "Suport", quantity: "1", unitPrice: "50.00", unitOfMeasure: unit, vatRateCode: "RO_STANDARD" })
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
