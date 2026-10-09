// Read-only companion of `gate:boundaries`. The gate answers "is the graph legal";
// this reports the graph itself, so an external analyser never has to re-derive the
// roots, the rule set or the cube areas and drift away from what the gate enforces.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { boundaryGateInputs, staticRuleCount } from "./boundary-gate-lib.mjs"

const SCHEMA_VERSION = 1
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024
const NON_CUBE_AREAS = ["standalone", "frontend/src"]
// Fingerprinted for audit: every input that can change the reported graph. No
// timestamp is recorded anywhere, so an unchanged repository hashes identically.
const SOURCES = [
  "dependency-cruiser.config.cjs",
  "probes/boundary-gate-lib.mjs",
  "probes/boundary-report.mjs",
  "probes/boundary-rules.mjs",
  "probes/source-tree.mjs",
  "qwbe.config.json",
]

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const executable = join(repositoryRoot, "node_modules", ".bin", "depcruise")

const HELP = `qwbe boundary-report — read-only dependency graph of the boundary gate

Usage: node probes/boundary-report.mjs [--json] [--root <path>] [--timeout <ms>] [--max-buffer <bytes>]

Scope
  Cruises exactly the roots, options and rule set of \`pnpm gate:boundaries\`
  (cube roots from qwbe.config.json plus standalone and frontend/src;
  test files included; no tsconfig), using the dependency-cruiser installed in
  this project. Reports raw counts; it never reports gate success or failure.

Side effects
  None on the repository. Writes one generated dependency-cruiser config into a
  fresh directory under the OS temp dir and removes it again. Reads no .env, no
  database, and runs no application code. Read-only: there is no --apply.

Options
  --json               print the machine-readable protocol on stdout, nothing else
  --root <path>        repository to cruise (default: this repository)
  --timeout <ms>       kill the depcruise child after this long (default: ${DEFAULT_TIMEOUT_MS})
  --max-buffer <bytes> cap on the child's captured output (default: ${DEFAULT_MAX_BUFFER})
  --help               this text

Protocol (--json), schemaVersion ${SCHEMA_VERSION}
  { schemaVersion, cruise, rules, depcruiseVersion, roots, areas, provenance }
  cruise      raw dependency-cruiser JSON output, unmodified
  rules       [{ name, severity }] of the full rule set actually used
  roots       cruised roots, relative to the cruised repository
  areas       [{ id, folder, group }]; cube units discovered by their
              qwbe-package.json plus ${NON_CUBE_AREAS.join(", ")}.
              group is the cube tree root for cube units and the first path
              segment otherwise. Assign a module to the area whose folder is its
              longest matching prefix, so a child cube owns its own files.
              Fallback: a module under no area folder is unassigned; a consumer
              may bucket it by its first path segment.
  provenance  { sources: [{ path, sha256 }] sorted by path, generatedRuleCount }
              generatedRuleCount counts only the dynamic cube rules.
              No timestamp is emitted, so the payload is stable across runs.

Exit codes
  0  graph collected, violations included
  1  execution or parse failure
  2  invalid usage

Example
  node probes/boundary-report.mjs --json > /tmp/boundary.json
`

// Failures travel as a thrown value and leave through one place. Writing the exit
// code instead of calling process.exit keeps a multi-megabyte payload intact: stdout
// on a pipe flushes asynchronously and process.exit would cut it off mid-write.
class ReportFailure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const fail = (code, message) => {
  throw new ReportFailure(code, message)
}

const numericOption = (argv, flag, fallback) => {
  const index = argv.indexOf(flag)
  if (index < 0) return fallback
  const value = Number(argv[index + 1])
  if (!Number.isInteger(value) || value <= 0) fail(2, `${flag} expects a positive integer`)
  return value
}

const stringOption = (argv, flag) => {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith("--")) fail(2, `${flag} expects a value`)
  return value
}

const fingerprint = (path) => ({
  path,
  sha256: createHash("sha256").update(readFileSync(join(repositoryRoot, path))).digest("hex"),
})

const treeRootOf = (id, ids) => ids
  .filter((candidate) => candidate === id || id.startsWith(`${candidate}/`))
  .sort((left, right) => left.length - right.length)[0] ?? id

const areasOf = (units, roots) => {
  const ids = units.map((unit) => unit.id)
  const cubes = ids.map((id) => ({ id, folder: id, group: treeRootOf(id, ids) }))
  const others = roots
    .filter((root) => NON_CUBE_AREAS.includes(root))
    .map((root) => ({ id: root, folder: root, group: root.split("/")[0] }))
  return [...cubes, ...others].sort((left, right) => left.id.localeCompare(right.id))
}

const cruiseGraph = (root, roots, generated, timeout, maxBuffer) => {
  const temporary = mkdtempSync(join(tmpdir(), "qwbe-boundary-report-"))
  const configPath = join(temporary, "dependency-cruiser.config.cjs")
  try {
    writeFileSync(configPath, `module.exports = ${JSON.stringify(generated, null, 2)}\n`)
    const result = spawnSync(executable, [...roots, "--config", configPath, "--output-type", "json"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout,
      maxBuffer,
      windowsHide: true,
    })
    // Both caps terminate the child with SIGTERM; the error code tells them apart.
    if (result.error?.code === "ENOBUFS") fail(1, `depcruise output exceeded the ${maxBuffer} byte cap`)
    if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
      fail(1, `depcruise exceeded the ${timeout}ms timeout`)
    }
    if (result.error) fail(1, `depcruise could not run (${result.error.code ?? "spawn failure"})`)
    try {
      const cruise = JSON.parse(result.stdout)
      if (!Array.isArray(cruise.modules) || typeof cruise.summary !== "object") {
        fail(1, "depcruise returned JSON without modules and summary")
      }
      return cruise
    } catch (error) {
      // A non-zero child status only matters when it did not produce a usable graph:
      // with --output-type json depcruise reports violations in the payload, not the code.
      const detail = result.status === 0 ? "output was not valid JSON" : `exited with status ${result.status}`
      fail(1, `depcruise produced no usable graph (${detail})`)
      throw error
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

const collect = (argv) => {
  const root = (() => {
    const given = stringOption(argv, "--root")
    return given === undefined ? repositoryRoot : resolve(given)
  })()
  const timeout = numericOption(argv, "--timeout", DEFAULT_TIMEOUT_MS)
  const maxBuffer = numericOption(argv, "--max-buffer", DEFAULT_MAX_BUFFER)
  const config = JSON.parse(readFileSync(join(repositoryRoot, "qwbe.config.json"), "utf8"))
  const depcruiseVersion = JSON.parse(
    readFileSync(join(repositoryRoot, "node_modules", "dependency-cruiser", "package.json"), "utf8"),
  ).version
  const { roots, generated, units } = boundaryGateInputs(root, config.cubeRoots)
  return {
    schemaVersion: SCHEMA_VERSION,
    cruise: cruiseGraph(root, roots, generated, timeout, maxBuffer),
    rules: generated.forbidden.map((rule) => ({ name: rule.name, severity: rule.severity })),
    depcruiseVersion,
    roots,
    areas: areasOf(units, roots),
    provenance: {
      sources: SOURCES.map(fingerprint).sort((left, right) => left.path.localeCompare(right.path)),
      generatedRuleCount: generated.forbidden.length - staticRuleCount,
    },
  }
}

const humanSummary = (payload) => {
  const { summary } = payload.cruise
  return [
    `roots            ${payload.roots.join(" ")}`,
    `modules          ${summary.totalCruised}`,
    `dependencies     ${summary.totalDependenciesCruised}`,
    `rules            ${payload.rules.length} (${payload.provenance.generatedRuleCount} generated)`,
    `areas            ${payload.areas.length}`,
    `violations       ${summary.violations.length} (error ${summary.error}, warn ${summary.warn}, info ${summary.info})`,
    `depcruise        ${payload.depcruiseVersion}`,
    "",
  ].join("\n")
}

const argv = process.argv.slice(2)
try {
  if (argv.includes("--help")) {
    process.stdout.write(HELP)
  } else {
    const payload = collect(argv)
    process.stdout.write(argv.includes("--json") ? `${JSON.stringify(payload)}\n` : humanSummary(payload))
  }
} catch (error) {
  const failure = error instanceof ReportFailure
  process.stderr.write(`boundary-report: ${failure ? error.message : String(error?.message ?? error).split("\n")[0]}\n`)
  process.exitCode = failure ? error.code : 1
}
