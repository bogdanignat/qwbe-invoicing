import assert from "node:assert/strict"
import test from "node:test"

import { archivedSeriesNotice, draftSeriesChoices, draftSeriesState } from "./draft-series.ts"
import { authoringSeriesOptions } from "./document-authoring-options.ts"
import { updateDraftPayload } from "./invoice-authoring-payload.ts"
import { draftWith, editable, form, harness, serverLine } from "./invoice-draft-save-controller.test.ts"

const series = (documentType: "invoice" | "proforma", name: string, archived: boolean) => ({ documentType, series: name, archived })

void test("only the active series of the authored type are offered", () => {
  const catalogue = [series("invoice", "FCT", false), series("invoice", "OLD", true), series("proforma", "PRO", false)]
  assert.deepEqual(authoringSeriesOptions(catalogue, "invoice"), ["FCT"])
  assert.deepEqual(authoringSeriesOptions(catalogue, "proforma"), ["PRO"])
})

void test("a draft saved on an archived series still shows it, marked, and nothing is chosen for it", () => {
  assert.deepEqual(draftSeriesChoices(["FCT", "NEW"], "OLD"), [
    { value: "OLD", label: "OLD (arhivată)" },
    { value: "FCT", label: "FCT" },
    { value: "NEW", label: "NEW" },
  ])
  assert.deepEqual(draftSeriesChoices(["FCT"], "FCT"), [{ value: "FCT", label: "FCT" }])
  assert.deepEqual(draftSeriesChoices(["FCT"], undefined), [{ value: "FCT", label: "FCT" }])
  assert.match(archivedSeriesNotice("OLD", ["FCT"]) ?? "", /Seria OLD e arhivată/u)
  assert.equal(archivedSeriesNotice("FCT", ["FCT"]), undefined)
})

void test("issuing waits on the chosen series, not on the saved one", () => {
  // Saved on OLD, archived since: choosing FCT lifts the series block (issuing still waits for the save).
  assert.equal(draftSeriesState("FCT", ["FCT"], "OLD").warning, undefined)
  assert.notEqual(draftSeriesState("OLD", ["FCT"], "OLD").warning, undefined)
  assert.deepEqual(draftSeriesState("FCT", ["FCT"], "OLD").choices.map((choice) => choice.value), ["OLD", "FCT"])
})

void test("the header update carries the chosen series", () => {
  assert.equal(updateDraftPayload(form({ series: "NEW" })).series, "NEW")
})

void test("moving a saved draft to another series writes the header before the lines", async () => {
  const saved = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const moved = { ...saved, series: "NEW" }
  const withSecond = { ...moved, lines: [...moved.lines, serverLine("line-2", "Suport", "50.00")] }
  const setup = harness({ updateDraft: () => moved, addDraftLine: () => withSecond })
  const outcome = await setup.controller.save({
    draft: saved, form: form({ series: "NEW" }),
    lines: [editable("line-1", "Consultanță", "100.00", "line-1"), editable("k2", "Suport", "50.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(outcome.kind, "saved")
  assert.deepEqual(setup.calls.map((call) => call.method), ["updateDraft", "addDraftLine"])
  assert.equal((setup.calls[0]?.args[2] as { series?: string }).series, "NEW")
})

void test("an unchanged series sends no header write", async () => {
  const saved = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({})
  const outcome = await setup.controller.save({
    draft: saved, form: form(), lines: [editable("line-1", "Consultanță", "100.00", "line-1")],
    forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(outcome.kind, "saved")
  assert.deepEqual(setup.calls, [])
})
