import assert from "node:assert/strict"
import test from "node:test"

import { archiveActionLabel, archiveActionText, archiveNotice, seriesKey, seriesStateLabel } from "./document-series-archive.ts"
import { decodeDocumentSeries } from "./authoring-reference-decoders.ts"

const active = { documentType: "invoice", series: "FCT", archived: false } as const
const archived = { documentType: "proforma", series: "PRO", archived: true } as const

void test("each row names its own series in the action, so repeated buttons stay distinct", () => {
  assert.equal(archiveActionLabel(active), "Arhivează seria FCT de factură")
  assert.equal(archiveActionLabel(archived), "Reactivează seria PRO de proformă")
  assert.equal(archiveActionLabel(active, true), "Se salvează seria FCT de factură")
  assert.notEqual(archiveActionLabel(active), archiveActionLabel({ ...active, documentType: "proforma" }))
  assert.equal(archiveActionText(active), "Arhivează")
  assert.equal(seriesStateLabel(active), "Activă")
  assert.equal(seriesStateLabel(archived), "Arhivată")
  assert.equal(seriesKey(active), "invoice:FCT")
})

void test("the notice follows the state the server answered", () => {
  assert.equal(archiveNotice(archived), "Seria PRO de proformă a fost arhivată: nu mai primește documente noi.")
  assert.equal(archiveNotice(active), "Seria FCT de factură a fost reactivată.")
})

void test("a series without a boolean archived flag is refused", () => {
  const wire = { organizationId: "org", documentType: "invoice", series: "FCT" }
  assert.deepEqual(decodeDocumentSeries({ ...wire, archived: true }), { ...wire, archived: true })
  assert.throws(() => decodeDocumentSeries(wire))
  assert.throws(() => decodeDocumentSeries({ ...wire, archived: 0 }))
})
