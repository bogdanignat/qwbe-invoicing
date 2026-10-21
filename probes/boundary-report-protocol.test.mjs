import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { boundaryGateInputs } from "./boundary-gate-lib.mjs"
import { makeUnit, repositoryRoot, runReport, withFixture } from "./boundary.test-support.mjs"

// One cruise of the real repository serves every test that only reads the payload.
let realRun
const real = () => {
  realRun ??= runReport("--json")
  return realRun
}
const realPayload = () => JSON.parse(real().stdout)

test("reports the real repository graph as the fixed protocol, without log contamination", () => {
  const result = real()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  const payload = realPayload()
  assert.deepEqual(Object.keys(payload), [
    "schemaVersion", "cruise", "rules", "depcruiseVersion", "roots", "areas", "provenance",
  ])
  assert.equal(payload.schemaVersion, 1)
  assert.ok(payload.cruise.modules.length > 0)
  assert.equal(typeof payload.cruise.summary.totalCruised, "number")
  assert.equal(
    payload.depcruiseVersion,
    JSON.parse(readFileSync(join(repositoryRoot, "node_modules", "dependency-cruiser", "package.json"), "utf8")).version,
  )
  assert.deepEqual(payload.roots, ["cubes", "kernel", "frontend/src"])
})

test("describes every cube unit and host root as an area with its family", async () => {
  const payload = realPayload()
  const { units } = await boundaryGateInputs(repositoryRoot)
  const expected = [...units.map((unit) => unit.id), "kernel", "frontend/src"].sort()
  assert.deepEqual(payload.areas.map((area) => area.id), expected)
  assert.deepEqual(payload.areas.map((area) => area.folder), expected)
  const group = (id) => payload.areas.find((area) => area.id === id).group
  assert.equal(group("cubes/invoicing"), "cubes/invoicing")
  assert.equal(group("cubes/invoicing/issuance"), "cubes/invoicing", "a child cube belongs to its tree root")
  assert.equal(group("frontend/src"), "frontend")
  assert.equal(group("kernel"), "kernel")
})

test("fingerprints the inputs that decide the graph, stably and without a timestamp", () => {
  const first = realPayload().provenance
  const second = JSON.parse(runReport("--json").stdout).provenance
  assert.deepEqual(first, second)
  assert.deepEqual(first.sources.map((source) => source.path), [
    "dependency-cruiser.config.cjs",
    "probes/boundary-gate-lib.mjs",
    "probes/boundary-report.mjs",
    "probes/boundary-rules.mjs",
    "probes/source-tree.mjs",
    "qwbe-package.json",
  ])
  for (const source of first.sources) assert.match(source.sha256, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(first).includes("generatedAt"))
})

test("reports exactly the rule set and roots the gate validates against", async () => {
  const payload = realPayload()
  const { roots, generated } = await boundaryGateInputs(repositoryRoot)
  assert.deepEqual(payload.roots, roots)
  assert.deepEqual(payload.rules, generated.forbidden.map((rule) => ({ name: rule.name, severity: rule.severity })))
  assert.ok(payload.provenance.generatedRuleCount > 0)
  assert.equal(payload.provenance.generatedRuleCount, payload.rules.filter((rule) =>
    rule.name.startsWith("no-cube-import-") || rule.name.startsWith("cube-tree-")
    || rule.name === "required-cube-does-not-import-plugin").length)
  assert.ok(payload.rules.some((rule) => rule.name === "required-cube-does-not-import-plugin"))
  assert.deepEqual(payload.cruise.summary.optionsUsed.doNotFollow, generated.options.doNotFollow)
  assert.equal(payload.cruise.summary.optionsUsed.tsPreCompilationDeps, true)
  assert.ok(payload.cruise.modules.some((module) => /[.]test[.]ts$/.test(module.source)), "test files stay in the graph")
})

test("collects a graph with violations and still exits zero, reporting raw counts", async () => {
  const result = await withFixture((root) => {
    makeUnit(root, "cubes/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cubes/reporting")
  }, (root) => runReport("--json", "--root", root))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.cruise.summary.error, 1)
  assert.deepEqual(payload.cruise.summary.violations.map((violation) => violation.rule.name),
    ["no-cube-import-cubes-invoicing-to-cubes-reporting"])
  assert.equal(payload.roots.length, 1)
  assert.deepEqual(payload.areas.map((area) => area.id), ["cubes/invoicing", "cubes/reporting"])
})
