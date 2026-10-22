import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { ISSUER_SAVE_UNREADABLE, issuerSaveError, issuerSaveNotes, NO_SAVE_NOTES } from "./issuer-save-notes.ts"
import { createRevisionGuard } from "./revision-guard.ts"
import { ISSUER_SAVED, ISSUER_SAVED_WHILE_EDITING, savedFormReplacesEdits } from "./settings-revisions.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

void test("an answer sets the notice, and the warning only when ANAF did not check the save", () => {
  assert.deepEqual(issuerSaveNotes({ kind: "saved", replacesEdits: true, warnings: [] }), { notice: ISSUER_SAVED, warning: undefined })
  const unchecked = issuerSaveNotes({ kind: "saved", replacesEdits: true, warnings: ["vat_registry_not_checked"] })
  assert.equal(unchecked.notice, ISSUER_SAVED)
  assert.match(unchecked.warning ?? "", /fără verificare în registrul ANAF/u)
})

void test("an answer that arrives after the user kept typing says the edits stayed, and still carries its warning", () => {
  const guard = createRevisionGuard()
  const asked = guard.current()
  guard.invalidate()
  const late = issuerSaveNotes({ kind: "saved", replacesEdits: savedFormReplacesEdits(guard, asked), warnings: ["vat_registry_not_checked"] })
  assert.equal(late.notice, ISSUER_SAVED_WHILE_EDITING)
  assert.notEqual(late.warning, undefined)
})

void test("a new save, a dismissal or a failure clears both, so neither stands next to an error", () => {
  for (const kind of ["sent", "dismissed", "failed"] as const) assert.deepEqual(issuerSaveNotes({ kind }), NO_SAVE_NOTES, kind)
})

void test("an unreadable answer reads as the issuer's own sentence, not the documents' one; other failures keep theirs", () => {
  const unreadable = issuerSaveError(new UnreadableAnswer(new Error("invalid warnings")))
  assert.ok(unreadable instanceof Error)
  assert.equal(unreadable.message, ISSUER_SAVE_UNREADABLE)
  assert.doesNotMatch(unreadable.message, /registrul|documentul/u)
  const refused = new ApiFailure({ message: "CIF-ul firmei nu mai poate fi schimbat.", status: 409 })
  assert.equal(issuerSaveError(refused), refused)
  assert.equal(issuerSaveError(null), null)
})
