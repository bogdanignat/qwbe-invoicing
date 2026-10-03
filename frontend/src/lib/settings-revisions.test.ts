import assert from "node:assert/strict"
import test from "node:test"

import {
  ISSUER_SAVED, ISSUER_SAVED_WHILE_EDITING, brandingSelectionEffect, savedFormReplacesEdits,
} from "./settings-revisions.ts"
import { createRevisionGuard } from "./revision-guard.ts"
import type { BrandingImageDraft } from "./issuer-branding.ts"

const DRAFT: BrandingImageDraft = {
  dataBase64: "AAA", previewUrl: "data:image/png;base64,AAA", width: 120, height: 40,
}

void test("branding selection — shows the preview of the file that is still the chosen one", () => {
  const guard = createRevisionGuard()
  const revision = guard.begin()
  assert.deepEqual(brandingSelectionEffect(guard, revision, { kind: "ready", draft: DRAFT }), {
    kind: "image", draft: DRAFT,
  })
  assert.deepEqual(brandingSelectionEffect(guard, revision, { kind: "issue", message: "Alege o imagine PNG sau JPEG." }), {
    kind: "issue", message: "Alege o imagine PNG sau JPEG.",
  })
})

void test("branding selection — a file that finished decoding after a second choice is ignored", () => {
  const guard = createRevisionGuard()
  const first = guard.begin()
  const second = guard.begin()
  assert.deepEqual(brandingSelectionEffect(guard, first, { kind: "ready", draft: DRAFT }), { kind: "ignore" })
  assert.deepEqual(brandingSelectionEffect(guard, first, { kind: "issue", message: "Imaginea poate avea maximum 256 KiB." }), {
    kind: "ignore",
  })
  assert.deepEqual(brandingSelectionEffect(guard, second, { kind: "ready", draft: DRAFT }), {
    kind: "image", draft: DRAFT,
  })
})

void test("branding selection — a file read that outlives an edit of the form is ignored", () => {
  const guard = createRevisionGuard()
  const revision = guard.begin()
  guard.invalidate()
  assert.deepEqual(brandingSelectionEffect(guard, revision, { kind: "ready", draft: DRAFT }), { kind: "ignore" })
})

void test("saved profile — replaces the form when nothing was typed while it was in flight", () => {
  const guard = createRevisionGuard()
  const revision = guard.current()
  assert.equal(savedFormReplacesEdits(guard, revision), true)
  assert.equal(ISSUER_SAVED, "Datele firmei au fost salvate.")
})

void test("saved profile — leaves the fields edited during the save, and says so", () => {
  const guard = createRevisionGuard()
  const revision = guard.current()
  guard.invalidate()
  assert.equal(savedFormReplacesEdits(guard, revision), false)
  assert.match(ISSUER_SAVED_WHILE_EDITING, /au rămas în formular\.$/u)
})

void test("saved profile — a later save is judged against the edits after it left", () => {
  const guard = createRevisionGuard()
  guard.invalidate()
  const second = guard.current()
  assert.equal(savedFormReplacesEdits(guard, second), true)
  guard.begin()
  assert.equal(savedFormReplacesEdits(guard, second), false)
})
