import assert from "node:assert/strict"
import test from "node:test"

import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { useRegisterFilters, type RegisterFiltersModel } from "./use-register-filters.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import { DEFAULT_PAGE_SIZE } from "../lib/register-page-size.ts"
import { presetDateRange } from "../lib/register-period.ts"

const firstRender = (): RegisterFiltersModel | undefined => {
  let model: RegisterFiltersModel | undefined
  const Probe = () => { model = useRegisterFilters(); return null }
  renderToString(createElement(Probe))
  return model
}

void test("the register opens on the current month, both kinds, no search, the default page size", () => {
  const model = firstRender()
  assert.ok(model)
  assert.equal(model.period, "month")
  assert.deepEqual(model.query, { range: presetDateRange("month", todayIn(ORGANIZATION_TIME_ZONE)), kind: "all", search: "", limit: DEFAULT_PAGE_SIZE })
  assert.equal(model.narrowed, true)
  assert.equal(model.customIssue, undefined)
})
