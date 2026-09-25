import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { createOperationReplay, REPLAY_SETTLED } from "./operation-replay.ts"
import type { ReplayClient } from "./operation-replay-requests.ts"
import type { ProformaIdentity } from "./proforma-replay-client.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"
import {
  RECOVERY_VERSION, type RecoveryOperation, type RecoveryRecord, type RecoveryRequest,
} from "./operation-recovery-types.ts"

/**
 * The explicit retry, after a reload or a lost answer: it sends the request that
 * was written down, under the key that was written down, and it adopts whatever
 * the server hands back. Nothing here may be rebuilt from the form on screen,
 * and nothing here may run on its own.
 */

const address = { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 } as const

const customer = {
  partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false, address,
} as const

const serverDraft: DraftInvoice = {
  id: "draft-1", organizationId: "org", customer, sourceProformaId: null,
  series: "FCT", issueDate: "2026-01-01", dueDate: null, currency: "RON", notes: null, status: "draft",
  lines: [{
    id: "line-1", description: "Consultanță", quantity: "1", unitPrice: "100.00",
    unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD",
    vatRate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    totalExcludingVat: "100.00", vatAmount: "21.00", totalIncludingVat: "121.00",
  }],
  vatBreakdown: [], totalExcludingVat: "100.00", vatTotal: "21.00", totalIncludingVat: "121.00",
}

const issuedInvoice: IssuedInvoice = {
  id: "inv-1", series: "FCT", number: 12, issueDate: "2026-01-01", dueDate: null, notes: null,
  currency: "RON", eFacturaStatus: "not_sent",
  issuer: {
    name: "Beta", fiscalIdentifier: "321", vatRegistered: true, legalForm: "srl",
    tradeRegistryNumber: "J40/1/2020", iban: "RO00XXXX0000000000", bankName: "Banca",
    socialCapital: "100.00", address,
  },
  customer, lines: [], vatBreakdown: [],
  totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

const proforma: ProformaIdentity = { id: "prf-1" }

/** Issuing a stored draft is still the "issue-invoice" operation: the request kind names the call, not the family. */
const operationOf = (kind: RecoveryRequest["kind"]): RecoveryOperation =>
  kind === "issue-draft" ? "issue-invoice" : kind

const storedRecord = (request: RecoveryRequest, state: RecoveryRecord["state"] = "pending"): RecoveryRecord => ({
  version: RECOVERY_VERSION,
  operation: operationOf(request.kind),
  key: "key-1", request, fingerprint: "fingerprint:1", createdAt: "2026-01-01T00:00:00.000Z",
  summary: { buyerName: "Alfa", series: "FCT", issueDate: "2026-01-01", lineCount: 1 }, state,
})

interface World {
  readonly replay: ReturnType<typeof createOperationReplay>["replay"]
  readonly calls: Array<{ readonly method: string; readonly key: string; readonly body: unknown }>
  readonly journal: string[]
  readonly effects: string[]
  readonly session: { owns: boolean; alive: boolean }
}

/** The proforma a conversion started from, as the effects see it: absent on writes authored directly. */
const from = (sourceProformaId: string | undefined): string =>
  sourceProformaId === undefined ? "" : `:from:${sourceProformaId}`

/** `effectsFail` is the navigation that throws *after* the server confirmed the write. */
const setup = (client: Partial<ReplayClient>, effectsFail?: Error): World => {
  const calls: Array<{ method: string; key: string; body: unknown }> = []
  const journal: string[] = []
  const effects: string[] = []
  const session = { owns: true, alive: true }
  const recovery: RecoveryPort = {
    hydrated: () => true,
    claim: () => { throw new Error("a replay never claims a new intent") },
    resolve: (key) => { journal.push(`resolve:${key}`); return true },
    markConflict: (key, conflict) => { journal.push(`conflict:${key}:${conflict}`) },
  }
  const unscripted = (method: string) => (): never => { throw new Error(`unscripted ${method}`) }
  const controller = createOperationReplay({
    client: {
      replayDraftCreation: async (csrfToken, body, key) => {
        calls.push({ method: "replayDraftCreation", key, body })
        return (client.replayDraftCreation ?? unscripted("replayDraftCreation"))(csrfToken, body, key)
      },
      issueDraft: async (csrfToken, id, key) => {
        calls.push({ method: "issueDraft", key, body: id })
        return (client.issueDraft ?? unscripted("issueDraft"))(csrfToken, id, key)
      },
      replayInvoiceIssuance: async (csrfToken, body, key) => {
        calls.push({ method: "replayInvoiceIssuance", key, body })
        return (client.replayInvoiceIssuance ?? unscripted("replayInvoiceIssuance"))(csrfToken, body, key)
      },
      replayProformaIssuance: async (csrfToken, body, key) => {
        calls.push({ method: "replayProformaIssuance", key, body })
        return (client.replayProformaIssuance ?? unscripted("replayProformaIssuance"))(csrfToken, body, key)
      },
      replayInvoiceFromProforma: async (csrfToken, id, body, key) => {
        calls.push({ method: `replayInvoiceFromProforma:${id}`, key, body })
        return (client.replayInvoiceFromProforma ?? unscripted("replayInvoiceFromProforma"))(csrfToken, id, body, key)
      },
      replayDraftFromProforma: async (csrfToken, id, body, key) => {
        calls.push({ method: `replayDraftFromProforma:${id}`, key, body })
        return (client.replayDraftFromProforma ?? unscripted("replayDraftFromProforma"))(csrfToken, id, body, key)
      },
    },
    recovery,
    csrfToken: () => "csrf-token",
    epoch: () => 3,
    ownsEpoch: () => session.owns,
    alive: () => session.alive,
    effects: {
      onDraft: (draft, sourceProformaId) => {
        effects.push(`onDraft:${draft.id}:${String(draft.lines.length)}${from(sourceProformaId)}`)
        if (effectsFail !== undefined) throw effectsFail
      },
      onIssued: (invoice, sourceProformaId) => {
        effects.push(`onIssued:${invoice.id}${from(sourceProformaId)}`)
        if (effectsFail !== undefined) throw effectsFail
      },
      onProforma: (issued) => {
        effects.push(`onProforma:${issued.id}`)
        if (effectsFail !== undefined) throw effectsFail
      },
    },
  })
  return { replay: controller.replay, calls, journal, effects, session }
}

const lost = (): ApiFailure => new ApiFailure({ message: "răspuns pierdut" })

void test("a stored create is sent again byte for byte, under the stored key", async () => {
  const body = { series: "FCT", lines: [{ description: "Consultanță" }] }
  const world = setup({ replayDraftCreation: () => Promise.resolve(serverDraft) })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body }))
  assert.equal(outcome.kind, "draft")
  assert.deepEqual(world.calls, [{ method: "replayDraftCreation", key: "key-1", body }])
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("the replayed draft is the server's, never the stored snapshot written back over it", async () => {
  const world = setup({ replayDraftCreation: () => Promise.resolve(serverDraft) })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: { series: "FCT", lines: [] } }))
  assert.equal(outcome.kind, "draft")
  assert.equal(outcome.draft, serverDraft)
  // One line on the server, none in the stored body: the server's copy wins.
  assert.deepEqual(world.effects, ["onDraft:draft-1:1"])
})

void test("a stored issue from a draft sends the id and the key, nothing else", async () => {
  const world = setup({ issueDraft: () => Promise.resolve(issuedInvoice) })
  const outcome = await world.replay(storedRecord({ kind: "issue-draft", draftId: "draft-1" }))
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls, [{ method: "issueDraft", key: "key-1", body: "draft-1" }])
  assert.deepEqual(world.effects, ["onIssued:inv-1"])
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a stored direct issue replays the stored body, not a payload rebuilt from a form", async () => {
  const body = { series: "FCT", issueDate: "2026-01-01" }
  const world = setup({ replayInvoiceIssuance: () => Promise.resolve(issuedInvoice) })
  const outcome = await world.replay(storedRecord({ kind: "issue-invoice", body }))
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls, [{ method: "replayInvoiceIssuance", key: "key-1", body }])
})

void test("a stored proforma issuance replays the stored body and is followed as a proforma", async () => {
  const body = { series: "PRO", issueDate: "2026-01-01" }
  const world = setup({ replayProformaIssuance: () => Promise.resolve(proforma) })
  const outcome = await world.replay(storedRecord({ kind: "create-proforma", body }))
  assert.equal(outcome.kind, "proforma")
  assert.equal(outcome.proforma.id, "prf-1")
  assert.deepEqual(world.calls, [{ method: "replayProformaIssuance", key: "key-1", body }])
  assert.deepEqual(world.effects, ["onProforma:prf-1"])
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a conversion to an invoice sends the proforma id from the path and is followed as an invoice", async () => {
  const body = { invoiceSeries: "FCT" }
  const world = setup({ replayInvoiceFromProforma: () => Promise.resolve(issuedInvoice) })
  const outcome = await world.replay(storedRecord({
    kind: "convert-proforma-invoice", proformaId: "prf-1", body,
  }))
  // The produced document is an invoice: a conversion is not its own family.
  assert.equal(outcome.kind, "issued")
  assert.deepEqual(world.calls, [{ method: "replayInvoiceFromProforma:prf-1", key: "key-1", body }])
  // The source proforma travels with the result: it is no longer convertible,
  // and the invoice the server returns carries no trace of it.
  assert.deepEqual(world.effects, ["onIssued:inv-1:from:prf-1"])
})

void test("a conversion to a draft is followed as a draft, under the same stored key", async () => {
  const body = { invoiceSeries: "FCT" }
  const world = setup({ replayDraftFromProforma: () => Promise.resolve(serverDraft) })
  const outcome = await world.replay(storedRecord({
    kind: "convert-proforma-draft", proformaId: "prf-1", body,
  }))
  assert.equal(outcome.kind, "draft")
  assert.deepEqual(world.calls, [{ method: "replayDraftFromProforma:prf-1", key: "key-1", body }])
  assert.deepEqual(world.effects, ["onDraft:draft-1:1:from:prf-1"])
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a proforma replay whose navigation throws is still a confirmed proforma", async () => {
  const navigation = new Error("router.push a eșuat")
  const world = setup({ replayProformaIssuance: () => Promise.resolve(proforma) }, navigation)
  const outcome = await world.replay(storedRecord({ kind: "create-proforma", body: {} }))
  assert.equal(outcome.kind, "proforma")
  assert.equal(outcome.effectsError, navigation)
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a spent key on a conversion is evidence, not a reason to convert again", async () => {
  const world = setup({
    replayInvoiceFromProforma: () => Promise.reject(new ApiFailure({
      message: "cheie refolosită", status: 409, code: "idempotency_key_reused",
    })),
  })
  const outcome = await world.replay(storedRecord({
    kind: "convert-proforma-invoice", proformaId: "prf-1", body: {},
  }))
  assert.equal(outcome.kind, "conflict")
  assert.deepEqual(world.journal, ["conflict:key-1:idempotency_key_reused"])
})

void test("a replay whose answer is lost again keeps the attempt exactly where it was", async () => {
  const world = setup({ replayDraftCreation: () => Promise.reject(lost()) })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }))
  assert.equal(outcome.kind, "unknown")
  // Neither resolved nor marked: the same key is still the only way to ask again.
  assert.deepEqual(world.journal, [])
  assert.deepEqual(world.effects, [])
})

void test("a spent key is recorded as evidence and never rotated", async () => {
  const world = setup({
    replayDraftCreation: () => Promise.reject(new ApiFailure({
      message: "cheie refolosită", status: 409, code: "idempotency_key_reused",
    })),
  })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }))
  assert.equal(outcome.kind, "conflict")
  assert.deepEqual(world.journal, ["conflict:key-1:idempotency_key_reused"])
})

void test("a deleted creation result is the same kind of dead end", async () => {
  const world = setup({
    replayDraftCreation: () => Promise.reject(new ApiFailure({
      message: "rezultatul a fost șters", status: 409, code: "draft_creation_result_deleted",
    })),
  })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }))
  assert.equal(outcome.kind, "conflict")
  assert.deepEqual(world.journal, ["conflict:key-1:draft_creation_result_deleted"])
})

void test("a settled refusal frees the slot: nothing was written", async () => {
  const world = setup({
    replayDraftCreation: () => Promise.reject(new ApiFailure({ message: "date invalide", status: 400 })),
  })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }))
  assert.equal(outcome.kind, "error")
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a record the server already refused for good is not sent again", async () => {
  const world = setup({})
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }, "conflict"))
  assert.equal(outcome.kind, "error")
  assert.ok(outcome.error instanceof Error && outcome.error.message === REPLAY_SETTLED)
  assert.deepEqual(world.calls, [])
  assert.deepEqual(world.journal, [])
})

void test("a session that ended before the answer changes nothing local", async () => {
  const world = setup({
    replayDraftCreation: () => {
      world.session.owns = false
      return Promise.resolve(serverDraft)
    },
  })
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body: {} }))
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
  assert.deepEqual(world.journal, [])
})

void test("a screen that unmounted mid-replay runs no effects", async () => {
  const world = setup({
    issueDraft: () => {
      world.session.alive = false
      return Promise.resolve(issuedInvoice)
    },
  })
  const outcome = await world.replay(storedRecord({ kind: "issue-draft", draftId: "draft-1" }))
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(world.effects, [])
})

void test("a second click while a replay is in flight sends nothing", async () => {
  let release: (() => void) | undefined
  let reached: (() => void) | undefined
  const sent = new Promise<void>((resolve) => { reached = resolve })
  const world = setup({
    replayDraftCreation: () => new Promise<DraftInvoice>((resolve) => {
      release = () => { resolve(serverDraft) }
      reached?.()
    }),
  })
  const record = storedRecord({ kind: "create-draft", body: {} })
  const first = world.replay(record)
  const second = await world.replay(record)
  await sent
  release?.()
  assert.equal((await first).kind, "draft")
  assert.equal(second.kind, "aborted")
  assert.equal(world.calls.length, 1)
})

// A confirmed write whose follow-up on the screen failed. The document exists;
// the only wrong answer here is one that looks like a failed operation and
// invites a second attempt.

void test("a draft replay whose navigation throws is still a confirmed draft, with the error carried alongside", async () => {
  const body = { series: "FCT", lines: [{ description: "Consultanță" }] }
  const navigation = new Error("router.replace a eșuat")
  const world = setup({ replayDraftCreation: () => Promise.resolve(serverDraft) }, navigation)
  const outcome = await world.replay(storedRecord({ kind: "create-draft", body }))
  assert.equal(outcome.kind, "draft")
  assert.equal(outcome.draft.id, "draft-1")
  assert.equal(outcome.effectsError, navigation)
  // The write is settled: the journal was freed before the effects ran.
  assert.deepEqual(world.journal, ["resolve:key-1"])
  assert.deepEqual(world.calls.map((call) => call.method), ["replayDraftCreation"])
})

void test("an issue replay whose navigation throws is still a confirmed invoice", async () => {
  const navigation = new Error("router.push a eșuat")
  const world = setup({ issueDraft: () => Promise.resolve(issuedInvoice) }, navigation)
  const outcome = await world.replay(storedRecord({ kind: "issue-draft", draftId: "draft-1" }))
  assert.equal(outcome.kind, "issued")
  assert.equal(outcome.invoice.id, "inv-1")
  assert.equal(outcome.effectsError, navigation)
  assert.deepEqual(world.journal, ["resolve:key-1"])
})

void test("a direct-issue replay whose navigation throws keeps the invoice identity", async () => {
  const body = { series: "FCT", lines: [] }
  const navigation = new Error("router.push a eșuat")
  const world = setup({ replayInvoiceIssuance: () => Promise.resolve(issuedInvoice) }, navigation)
  const outcome = await world.replay(storedRecord({ kind: "issue-invoice", body }))
  assert.equal(outcome.kind, "issued")
  assert.equal(outcome.invoice.id, "inv-1")
  assert.equal(outcome.effectsError, navigation)
})

void test("the failed follow-up is never retried as a request: the record is gone and a second replay sends nothing", async () => {
  const body = { series: "FCT", lines: [{ description: "Consultanță" }] }
  const record = storedRecord({ kind: "create-draft", body })
  const world = setup({ replayDraftCreation: () => Promise.resolve(serverDraft) }, new Error("navigare eșuată"))
  assert.equal((await world.replay(record)).kind, "draft")
  assert.equal(world.calls.length, 1)
  // The UI recovering from its own navigation failure must not resend: the slot
  // was resolved, so the notice the screen shows is the known-result one, not a
  // replay button.
  assert.deepEqual(world.journal, ["resolve:key-1"])
})
