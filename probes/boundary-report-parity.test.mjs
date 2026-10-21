import assert from "node:assert/strict"
import test from "node:test"

import { boundaryGateInputs } from "./boundary-gate-lib.mjs"
import { makeUnit, runGate, runReport, withFixture, write } from "./boundary.test-support.mjs"

// The gate prints one `<severity> <rule>: <from> → <to>` line per violation; the
// report carries the same facts in `cruise.summary.violations`. On the same input
// both must name the same violations, and the gate fails exactly when the report
// counts an error. The pattern reads only single-line violations: the `err` reporter
// prints a cycle as a multi-line block, so the fixtures here deliberately have none.
const GATE_VIOLATION = /^\s*(error|warn|info) (\S+): (\S+) → (\S+)$/gmu
const gateViolations = (output) =>
  [...output.matchAll(GATE_VIOLATION)].map(([, severity, rule, from, to]) => `${severity} ${rule}: ${from} → ${to}`).sort()
const reportViolations = (payload) => payload.cruise.summary.violations
  .map((violation) => `${violation.rule.severity} ${violation.rule.name}: ${violation.from} → ${violation.to}`).sort()

const compare = async (root) => {
  const gate = runGate("--root", root)
  const report = runReport("--json", "--root", root)
  assert.equal(report.status, 0, report.stderr)
  const payload = JSON.parse(report.stdout)
  const { roots, generated } = await boundaryGateInputs(root)
  assert.deepEqual(payload.roots, roots)
  assert.deepEqual(payload.rules.map((rule) => rule.name), generated.forbidden.map((rule) => rule.name))
  assert.deepEqual(gateViolations(gate.stdout + gate.stderr), reportViolations(payload))
  assert.equal(gate.status !== 0, payload.cruise.summary.error > 0, gate.stdout + gate.stderr)
  return { gate, payload }
}

test("names the same violations as the gate on a tree that breaks several rules", async () => {
  const { gate, payload } = await withFixture((root) => {
    makeUnit(root, "cubes/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cubes/reporting", 'import "node:fs"\nexport const reporting = 1\n')
    write(root, "cubes/reporting/domain/rule.ts", "export const rule = 1\n")
    write(root, "kernel/main.ts", 'import { rule } from "../cubes/reporting/domain/rule.ts"\nvoid rule\n')
  }, compare)
  assert.notEqual(gate.status, 0, "the gate still fails on a violating tree")
  assert.deepEqual([...new Set(payload.cruise.summary.violations.map((violation) => violation.rule.name))].sort(), [
    "cube-does-not-touch-runtime-infrastructure",
    "kernel-uses-only-public-cube-surface",
    "no-cube-import-cubes-invoicing-to-cubes-reporting",
  ])
})

test("finds nothing where the gate passes, on the same clean tree", async () => {
  const { gate, payload } = await withFixture((root) => {
    makeUnit(root, "cubes/invoicing", "export const cube = {}\n")
    write(root, "kernel/main.ts", 'import { cube } from "../cubes/invoicing/index.ts"\nvoid cube\n')
  }, compare)
  assert.equal(gate.status, 0, gate.stdout + gate.stderr)
  assert.deepEqual(payload.cruise.summary.violations, [])
})
