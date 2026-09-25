import assert from "node:assert/strict"
import test from "node:test"

import {
  BLOCKED_CONFLICT, BLOCKED_CORRUPT, BLOCKED_MARKER, BLOCKED_OTHER, BLOCKED_UNAVAILABLE,
  createRecoveryJournal, RECOVERY_SLOT,
  type JournalStorage, type RecoveryIntent, type RecoveryJournal,
} from "./operation-recovery-journal.ts"
import { decodeJournalEntry } from "./operation-recovery-types.ts"

/**
 * The journal is the only thing standing between a lost answer and a second
 * document, so every one of its refusals matters more than its successes: a
 * storage it cannot read, cannot write or cannot trust must stop the request,
 * never wave it through.
 */

interface Store {
  readonly storage: JournalStorage
  readonly raw: () => string | null
  set: (value: string) => void
  failSet: boolean
  failRemove: boolean
  failGet: boolean
}

const store = (): Store => {
  const slots = new Map<string, string>()
  const state: Store = {
    raw: () => slots.get(RECOVERY_SLOT) ?? null,
    set: (value) => { slots.set(RECOVERY_SLOT, value) },
    failSet: false,
    failRemove: false,
    failGet: false,
    storage: {
      getItem: (key) => {
        if (state.failGet) throw new Error("SecurityError")
        return slots.get(key) ?? null
      },
      setItem: (key, value) => {
        if (state.failSet) throw new Error("QuotaExceededError")
        slots.set(key, value)
      },
      removeItem: (key) => {
        if (state.failRemove) throw new Error("SecurityError")
        slots.delete(key)
      },
    },
  }
  return state
}

const journalOver = (
  storage: () => JournalStorage | undefined,
): { readonly journal: RecoveryJournal; readonly keys: () => ReadonlyArray<string> } => {
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
  return { journal, keys: () => issued }
}

const intent = (description = "Consultanță"): RecoveryIntent => ({
  operation: "create-draft",
  request: { kind: "create-draft", body: { series: "FCT", lines: [{ description }] } },
  fingerprint: `fingerprint:${description}`,
  summary: { buyerName: "Alfa", series: "FCT", issueDate: "2026-01-01", lineCount: 1 },
})

const issuing: RecoveryIntent = {
  operation: "issue-invoice",
  request: { kind: "issue-draft", draftId: "draft-1" },
  fingerprint: "fingerprint:issue",
  summary: { buyerName: "Alfa", series: "FCT", issueDate: "2026-01-01", lineCount: 1 },
}

void test("an intent is on disk before the request may leave", () => {
  const backing = store()
  const { journal, keys } = journalOver(() => backing.storage)
  const claimed = journal.claim(intent())
  assert.equal(claimed.kind, "claimed")
  assert.equal(claimed.replay, false)
  assert.equal(claimed.record.key, "key-1")
  assert.equal(claimed.record.state, "pending")
  assert.deepEqual(keys(), ["key-1"])
  const entry = decodeJournalEntry(backing.raw())
  assert.equal(entry.kind, "record")
  assert.deepEqual(entry.record.request, intent().request)
})

void test("nothing secret is written down: no token, no CSRF value", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  const raw = backing.raw() ?? ""
  assert.equal(raw.toLowerCase().includes("token"), false)
  assert.equal(raw.toLowerCase().includes("csrf"), false)
})

void test("the same document again is the same attempt, not a second one", () => {
  const backing = store()
  const { journal, keys } = journalOver(() => backing.storage)
  const first = journal.claim(intent())
  const second = journal.claim(intent())
  assert.equal(first.kind, "claimed")
  assert.equal(second.kind, "claimed")
  assert.equal(second.replay, true)
  assert.equal(second.record.key, first.record.key)
  assert.deepEqual(keys(), ["key-1"])
})

void test("a reload finds the intent: a new journal over the same tab replays the stored key", () => {
  const backing = store()
  journalOver(() => backing.storage).journal.claim(intent())
  // A fresh mount after F5: a different journal instance, the same tab storage.
  const reloaded = journalOver(() => backing.storage)
  const entry = reloaded.journal.read()
  assert.equal(entry.kind, "record")
  const claimed = reloaded.journal.claim(intent())
  assert.equal(claimed.kind, "claimed")
  assert.equal(claimed.replay, true)
  assert.equal(claimed.record.key, "key-1")
  // No key was minted by the second journal: the stored one is the only one.
  assert.deepEqual(reloaded.keys(), [])
})

void test("a changed document cannot start while another is unresolved", () => {
  const backing = store()
  const { journal, keys } = journalOver(() => backing.storage)
  journal.claim(intent())
  const blocked = journal.claim(intent("Altceva"))
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_OTHER)
  assert.deepEqual(keys(), ["key-1"])
})

void test("saving and issuing block each other: one slot, one unresolved write", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  const blocked = journal.claim(issuing)
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_OTHER)
})

void test("a storage that cannot be reached at all fails closed", () => {
  const { journal, keys } = journalOver(() => undefined)
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_UNAVAILABLE)
  // The refusal comes from the read, before a key is even minted.
  assert.deepEqual(keys(), [])
})

void test("a read that throws fails closed rather than pretending the slot is empty", () => {
  const backing = store()
  backing.failGet = true
  const { journal } = journalOver(() => backing.storage)
  assert.equal(journal.read().kind, "unavailable")
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_UNAVAILABLE)
})

void test("a write the storage refuses stops the request: an unrecoverable send is not sent", () => {
  const backing = store()
  backing.failSet = true
  const { journal } = journalOver(() => backing.storage)
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_UNAVAILABLE)
  assert.equal(backing.raw(), null)
})

void test("text that does not decode is corrupt, and corrupt blocks", () => {
  const backing = store()
  backing.set("{not json")
  const { journal } = journalOver(() => backing.storage)
  assert.equal(journal.read().kind, "corrupt")
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_CORRUPT)
})

void test("a record from another build is corrupt, not half-read", () => {
  const backing = store()
  backing.set(JSON.stringify({ version: 2, operation: "create-draft", key: "old" }))
  const { journal } = journalOver(() => backing.storage)
  assert.equal(journal.read().kind, "corrupt")
  backing.set(JSON.stringify({ version: 1, operation: "create-draft", key: "old" }))
  assert.equal(journal.read().kind, "corrupt")
})

void test("a definitive refusal is kept as evidence and blocks until it is dismissed", () => {
  const backing = store()
  const { journal, keys } = journalOver(() => backing.storage)
  const claimed = journal.claim(intent())
  assert.equal(claimed.kind, "claimed")
  journal.markConflict(claimed.record.key, "idempotency_key_reused")
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_CONFLICT)
  // No new key: a spent key is not rotated, it is read.
  assert.deepEqual(keys(), ["key-1"])
  const entry = journal.read()
  assert.equal(entry.kind, "record")
  assert.equal(entry.record.state, "conflict")
  assert.equal(entry.record.conflict, "idempotency_key_reused")
})

void test("a controller may only settle the record it wrote", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  assert.equal(journal.resolve("key-someone-else"), true)
  assert.equal(journal.read().kind, "record")
  journal.markConflict("key-someone-else", "idempotency_key_reused")
  const entry = journal.read()
  assert.equal(entry.kind === "record" && entry.record.state, "pending")
  assert.equal(journal.resolve("key-1"), true)
  assert.equal(journal.read().kind, "empty")
})

void test("a storage that refuses to forget reports it instead of lying", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  backing.failRemove = true
  assert.equal(journal.resolve("key-1"), false)
  assert.equal(journal.read().kind, "record")
})

void test("the same document confirmed twice is two operations under two keys", () => {
  const backing = store()
  const { journal, keys } = journalOver(() => backing.storage)
  journal.claim(intent())
  journal.resolve("key-1")
  const again = journal.claim(intent())
  assert.equal(again.kind, "claimed")
  assert.equal(again.replay, false)
  assert.equal(again.record.key, "key-2")
  assert.deepEqual(keys(), ["key-1", "key-2"])
})

void test("logout takes the payload and the key and leaves only the fact", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  assert.equal(journal.strip(), true)
  const raw = backing.raw() ?? ""
  assert.equal(raw.includes("key-1"), false)
  assert.equal(raw.includes("Consultanță"), false)
  const entry = journal.read()
  assert.equal(entry.kind, "marker")
  assert.equal(entry.marker.operation, "create-draft")
})

void test("a stale callback cannot resurrect a payload the logout removed", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  journal.strip()
  // Answers from the old session arriving late: neither may rewrite the slot.
  journal.markConflict("key-1", "idempotency_key_reused")
  assert.equal(journal.resolve("key-1"), true)
  assert.equal(journal.read().kind, "marker")
  assert.equal((backing.raw() ?? "").includes("Consultanță"), false)
})

void test("a logout whose marker cannot be written still removes the payload", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  backing.failSet = true
  assert.equal(journal.strip(), true)
  assert.equal(backing.raw(), null)
})

void test("the marker blocks new writes and leaves only by explicit confirmation", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  journal.strip()
  const blocked = journal.claim(intent())
  assert.equal(blocked.kind, "blocked")
  assert.equal(blocked.message, BLOCKED_MARKER)
  assert.equal(journal.dismiss(), true)
  assert.equal(journal.read().kind, "empty")
  assert.equal(journal.claim(intent()).kind, "claimed")
})

void test("an unresolved write cannot be dismissed away", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  assert.equal(journal.dismiss(), false)
  assert.equal(journal.read().kind, "record")
})

void test("a settled conflict is dismissable, and a dismissal the storage refuses says so", () => {
  const backing = store()
  const { journal } = journalOver(() => backing.storage)
  journal.claim(intent())
  journal.markConflict("key-1", "draft_creation_result_deleted")
  backing.failRemove = true
  assert.equal(journal.dismiss(), false)
  backing.failRemove = false
  assert.equal(journal.dismiss(), true)
  assert.equal(journal.read().kind, "empty")
})
