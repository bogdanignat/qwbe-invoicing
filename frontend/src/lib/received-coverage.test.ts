import assert from "node:assert/strict"
import test from "node:test"

import { coverageView } from "./received-coverage.ts"

const DAY_MS = 86_400_000
const COVERED = "2026-08-01T09:00:00.000Z"
const after = (days: number, extraMs = 0) => new Date(Date.parse(COVERED) + days * DAY_MS + extraMs)

void test("before the first complete fetch the page says what the first one brings, with no warning", () => {
  const view = coverageView(null, after(0))
  assert.match(view.text, /^Nicio preluare completă încă\. Prima preluare aduce facturile primite din ultimele 60 de zile/u)
  assert.equal(view.warning, undefined)
})

void test("the coverage is the checkpoint, read in Bucharest time", () => {
  assert.equal(coverageView(COVERED, after(1)).text, "Ultima acoperire: facturile primite sunt preluate complet până la 01.08.2026, 12:00.")
})

void test("up to exactly 50 days from the checkpoint there is no warning; past them there is", () => {
  assert.equal(coverageView(COVERED, after(50)).warning, undefined)
  const warned = coverageView(COVERED, after(50, 1))
  assert.match(warned.warning ?? "", /^Au trecut 50 de zile de la ultima acoperire\. ANAF listează cel mult 60 de zile în urmă: preia acum/u)
  assert.match(coverageView(COVERED, after(55)).warning ?? "", /^Au trecut 55 de zile/u)
})

void test("past 60 days the warning says the older days can no longer be fetched from here", () => {
  assert.match(coverageView(COVERED, after(60)).warning ?? "", /preia acum/u, "60 days is still listed")
  assert.match(coverageView(COVERED, after(61)).warning ?? "", /^Au trecut 61 de zile.*nu mai pot fi preluate de aici\.$/u)
})

void test("a checkpoint in the future or unreadable warns of nothing", () => {
  assert.equal(coverageView(COVERED, after(-3)).warning, undefined)
  assert.equal(coverageView("not a date", after(90)).warning, undefined)
})
