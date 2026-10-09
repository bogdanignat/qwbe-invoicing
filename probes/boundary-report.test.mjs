import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { boundaryGateInputs } from "./boundary-gate-lib.mjs"

const probes = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(probes, "..")
const report = join(probes, "boundary-report.mjs")
const gate = join(probes, "boundary-gate.mjs")
const cubeRoots = JSON.parse(readFileSync(join(repositoryRoot, "qwbe.config.json"), "utf8")).cubeRoots

const run = (...args) => spawnSync(process.execPath, [report, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-boundary-report-test-"))
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const makeUnit = (root, path, source = "export const value = 1\n") => {
  write(root, `${path}/qwbe-package.json`, "{}\n")
  write(root, `${path}/index.ts`, source)
}
const withFixture = (build, use) => {
  const root = fixture()
  try {
    build(root)
    return use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("reports the real repository graph as the fixed protocol, without log contamination", () => {
  const result = run("--json")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  const payload = JSON.parse(result.stdout)
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
  assert.deepEqual(payload.roots, ["cube", "standalone", "frontend/src"])
})

test("describes every cube unit and host root as an area with its family", () => {
  const payload = JSON.parse(run("--json").stdout)
  const { units } = boundaryGateInputs(repositoryRoot, cubeRoots)
  const expected = [...units.map((unit) => unit.id), "standalone", "frontend/src"].sort()
  assert.deepEqual(payload.areas.map((area) => area.id), expected)
  assert.deepEqual(payload.areas.map((area) => area.folder), expected)
  const group = (id) => payload.areas.find((area) => area.id === id).group
  assert.equal(group("cube/invoicing"), "cube/invoicing")
  assert.equal(group("cube/invoicing/issuance"), "cube/invoicing", "a child cube belongs to its tree root")
  assert.equal(group("frontend/src"), "frontend")
  assert.equal(group("standalone"), "standalone")
})

test("fingerprints the inputs that decide the graph, stably and without a timestamp", () => {
  const first = JSON.parse(run("--json").stdout).provenance
  const second = JSON.parse(run("--json").stdout).provenance
  assert.deepEqual(first, second)
  assert.deepEqual(first.sources.map((source) => source.path), [
    "dependency-cruiser.config.cjs",
    "probes/boundary-gate-lib.mjs",
    "probes/boundary-report.mjs",
    "probes/boundary-rules.mjs",
    "probes/source-tree.mjs",
    "qwbe.config.json",
  ])
  for (const source of first.sources) assert.match(source.sha256, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(first).includes("generatedAt"))
})

test("reports exactly the rule set and roots the gate validates against", () => {
  const payload = JSON.parse(run("--json").stdout)
  const { roots, generated } = boundaryGateInputs(repositoryRoot, cubeRoots)
  assert.deepEqual(payload.roots, roots)
  assert.deepEqual(payload.rules, generated.forbidden.map((rule) => ({ name: rule.name, severity: rule.severity })))
  assert.ok(payload.provenance.generatedRuleCount > 0)
  assert.equal(payload.provenance.generatedRuleCount, payload.rules.filter((rule) =>
    rule.name.startsWith("no-cube-import-") || rule.name.startsWith("cube-tree-")).length)
  assert.deepEqual(payload.cruise.summary.optionsUsed.doNotFollow, generated.options.doNotFollow)
  assert.equal(payload.cruise.summary.optionsUsed.tsPreCompilationDeps, true)
  assert.ok(payload.cruise.modules.some((module) => /[.]test[.]ts$/.test(module.source)), "test files stay in the graph")
})

test("collects a graph with violations and still exits zero, reporting raw counts", () => {
  const result = withFixture((root) => {
    makeUnit(root, "cube/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cube/reporting")
  }, (root) => run("--json", "--root", root))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.cruise.summary.error, 1)
  assert.deepEqual(payload.cruise.summary.violations.map((violation) => violation.rule.name),
    ["no-cube-import-cube-invoicing-to-cube-reporting"])
  assert.equal(payload.roots.length, 1)
  assert.deepEqual(payload.areas.map((area) => area.id), ["cube/invoicing", "cube/reporting"])
})

test("stays a reporter where the gate is a gate, on the same fixture", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cube/reporting")
    const gateResult = spawnSync(process.execPath, [gate, "--root", root], { encoding: "utf8" })
    assert.notEqual(gateResult.status, 0, "the gate still fails on a violating tree")
    const payload = JSON.parse(run("--json", "--root", root).stdout)
    const { roots, generated } = boundaryGateInputs(root, cubeRoots)
    assert.deepEqual(payload.roots, roots)
    assert.deepEqual(payload.rules.map((rule) => rule.name), generated.forbidden.map((rule) => rule.name))
    assert.match(gateResult.stdout + gateResult.stderr, new RegExp(payload.cruise.summary.violations[0].rule.name))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("separates usage errors from execution failures", () => {
  const usage = run("--timeout", "abc")
  assert.equal(usage.status, 2)
  assert.equal(usage.stdout, "")
  assert.match(usage.stderr, /--timeout expects a positive integer/)
  assert.equal(run("--max-buffer", "0").status, 2)
  assert.equal(run("--root").status, 2)

  const timedOut = run("--json", "--timeout", "1")
  assert.equal(timedOut.status, 1)
  assert.equal(timedOut.stdout, "")
  assert.match(timedOut.stderr, /exceeded the 1ms timeout/)

  const capped = run("--json", "--max-buffer", "1000")
  assert.equal(capped.status, 1)
  assert.equal(capped.stdout, "")
  assert.match(capped.stderr, /output exceeded the 1000 byte cap/)
})

test("keeps failure messages short and free of the environment", () => {
  const timedOut = run("--json", "--timeout", "1")
  assert.equal(timedOut.stderr.trim().split("\n").length, 1)
  assert.match(timedOut.stderr, /^boundary-report: /)
  assert.ok(!/[A-Z_]{3,}=/.test(timedOut.stderr))
})

test("prints human counts without the protocol, and documents itself", () => {
  const human = run()
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /^roots {12}cube standalone frontend\/src$/m)
  assert.match(human.stdout, /^modules {10}\d+$/m)
  assert.match(human.stdout, /^violations {7}\d+ \(error \d+, warn \d+, info \d+\)$/m)
  assert.ok(!human.stdout.includes("schemaVersion"))
  assert.ok(!/no dependency violations found|✔/.test(human.stdout), "it never reports gate success")

  const help = run("--help")
  assert.equal(help.status, 0)
  assert.match(help.stdout, /read-only/)
  assert.match(help.stdout, /schemaVersion, cruise, rules, depcruiseVersion, roots, areas, provenance/)
  assert.match(help.stdout, /longest matching prefix/)
  assert.match(help.stdout, /0 {2}graph collected, violations included/)
})
