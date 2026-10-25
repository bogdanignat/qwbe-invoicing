import assert from "node:assert/strict"
import test from "node:test"

import { STALE_TAX_WARNING, documentLinesStarted } from "./document-authoring-readiness.ts"
import { newEditableDocumentLine } from "./document-authoring-form-model.ts"
import {
  INCOMPLETE_LINES_ISSUE, UNSAVED_CHANGES_ISSUE, invoiceDueDateIssue, issueBlockReasons, type IssueBlockInput,
} from "./invoice-authoring-workflow.ts"

const ready: IssueBlockInput = {
  readiness: { editable: true, synchronized: true, hasLines: true },
  hasDraft: true, linesStarted: true, pending: false, staleTaxWarning: null, dueDateIssue: null, seriesWarning: undefined,
}

const dueDateMissing = invoiceDueDateIssue(true)

void test("an issuable document gives no reason at all", () => {
  assert.deepEqual(issueBlockReasons(ready), [])
})

void test("a missing due date is named with the message the field already uses", () => {
  assert.ok(dueDateMissing !== null)
  assert.deepEqual(issueBlockReasons({ ...ready, dueDateIssue: dueDateMissing }), [dueDateMissing])
})

void test("every other rule that closes issuance says so, in a stable order", () => {
  const series = "Seria FCT este arhivată."
  assert.deepEqual(issueBlockReasons({
    ...ready,
    readiness: { editable: true, synchronized: false, hasLines: false },
    staleTaxWarning: STALE_TAX_WARNING, dueDateIssue: dueDateMissing, seriesWarning: series,
  }), [INCOMPLETE_LINES_ISSUE, UNSAVED_CHANGES_ISSUE, STALE_TAX_WARNING, dueDateMissing, series])
})

void test("a new document is never 'unsaved': it may be issued directly", () => {
  assert.deepEqual(issueBlockReasons({
    ...ready, hasDraft: false, readiness: { editable: true, synchronized: false, hasLines: true },
  }), [])
})

void test("a write in flight or a locked draft does not list reasons", () => {
  const blocked = { ...ready, dueDateIssue: dueDateMissing }
  assert.deepEqual(issueBlockReasons({ ...blocked, pending: true }), [])
  assert.deepEqual(issueBlockReasons({ ...blocked, readiness: { ...ready.readiness, editable: false } }), [])
})

void test("a blank new document is not told to complete its lines until one is started", () => {
  const blank = newEditableDocumentLine("line-1", "RO_STANDARD", { code: "C62", name: "unitate" })
  assert.equal(documentLinesStarted([blank]), false)
  assert.equal(documentLinesStarted([{ ...blank, description: " " }]), false)
  assert.equal(documentLinesStarted([{ ...blank, unitPrice: "10" }]), true)
  assert.equal(documentLinesStarted([{ ...blank, itemCode: "A-1" }]), true)
  const untouched = {
    ...ready, hasDraft: false, linesStarted: documentLinesStarted([blank]),
    readiness: { editable: true, synchronized: false, hasLines: false },
  }
  assert.deepEqual(issueBlockReasons(untouched), [])
  assert.deepEqual(issueBlockReasons({ ...untouched, linesStarted: true }), [INCOMPLETE_LINES_ISSUE])
  // A saved draft always says it, typed or not: it was opened to be finished.
  assert.deepEqual(issueBlockReasons({ ...untouched, hasDraft: true, readiness: { ...untouched.readiness, synchronized: true } }),
    [INCOMPLETE_LINES_ISSUE])
})
