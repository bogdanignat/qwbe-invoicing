// Read-only companion of `gate:boundaries`. The gate answers "is the graph legal";
// this reports the graph itself, so an external analyser never has to re-derive the
// roots, the rule set or the cube areas and drift away from what the gate enforces.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { boundaryGateInputs, cruiseBoundaries, depcruiseExecutable, staticRuleCount } from "./boundary-gate-lib.mjs"
import { fail, helpText, parseArguments, ReportFailure } from "./boundary-report-usage.mjs"
import { PackageManifestError } from "./source-tree.mjs"

const SCHEMA_VERSION = 1
const NON_CUBE_AREAS = ["kernel", "frontend/src"]
// Fingerprinted for audit: every input that can change the reported graph. No
// timestamp is recorded anywhere, so an unchanged repository hashes identically.
const SOURCES = [
  "dependency-cruiser.config.cjs",
  "probes/boundary-gate-lib.mjs",
  "probes/boundary-report.mjs",
  "probes/boundary-rules.mjs",
  "probes/source-tree.mjs",
  "qwbe-package.json",
]

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const firstLine = (text) => String(text ?? "").trim().split("\n")[0]

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

const cruiseRoot = (given) => {
  if (given === undefined) return repositoryRoot
  if (!statSync(given, { throwIfNoEntry: false })?.isDirectory()) {
    fail(2, `--root ${given} is not a directory; pass the path of a repository checkout`)
  }
  return given
}

const depcruiseVersion = () => {
  const manifest = join(repositoryRoot, "node_modules", "dependency-cruiser", "package.json")
  if (!existsSync(manifest) || !existsSync(depcruiseExecutable)) {
    fail(1, `dependency-cruiser is not installed (${join(repositoryRoot, "node_modules")}); `
      + "run pnpm install (or scripts/verify-docker.sh install), then rerun")
  }
  return JSON.parse(readFileSync(manifest, "utf8")).version
}

// Only a manifest the inventory refuses gets the "fix qwbe-package.json" advice;
// anything else (a cube index.ts that throws, a bug here) surfaces unchanged.
const gateInputs = async (root) => {
  try {
    return await boundaryGateInputs(root)
  } catch (error) {
    if (!(error instanceof PackageManifestError)) throw error
    return fail(1, `cannot read the cube tree: ${error.message} (${root}); `
      + "fix qwbe-package.json or the cube it names, then rerun")
  }
}

const parsedGraph = (stdout) => {
  try {
    const cruise = JSON.parse(stdout)
    return Array.isArray(cruise?.modules) && typeof cruise.summary === "object" ? cruise : undefined
  } catch {
    return undefined
  }
}

const cruiseGraph = (root, inputs, { timeout, maxBuffer }) => {
  const result = cruiseBoundaries(root, inputs, ["--output-type", "json"], { timeout, maxBuffer })
  const where = `cruising ${root}`
  // Both caps terminate the child with SIGTERM; the error code tells them apart.
  if (result.error?.code === "ENOBUFS") {
    fail(1, `depcruise output exceeded the ${maxBuffer} byte cap (${where}); rerun with a larger --max-buffer`)
  }
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    fail(1, `depcruise exceeded the ${timeout}ms timeout (${where}); rerun with a larger --timeout`)
  }
  if (result.error) {
    fail(1, `depcruise could not run (${result.error.code ?? "spawn failure"}, ${depcruiseExecutable}); `
      + "run pnpm install, then rerun")
  }
  const cruise = parsedGraph(result.stdout)
  if (cruise !== undefined) return cruise
  // A non-zero child status only matters when it did not produce a usable graph:
  // with --output-type json depcruise reports violations in the payload, not the code.
  const detail = result.status === 0 ? "output was not valid JSON" : `exited with status ${result.status}`
  const said = firstLine(result.stderr)
  return fail(1, `depcruise produced no usable graph (${detail}, ${where})${said ? `: ${said}` : ""}; `
    + `run node probes/boundary-gate.mjs --root ${root} for its full output`)
}

const collect = async (options) => {
  const root = cruiseRoot(options.root)
  const version = depcruiseVersion()
  const inputs = await gateInputs(root)
  const { roots, generated, units } = inputs
  return {
    schemaVersion: SCHEMA_VERSION,
    cruise: cruiseGraph(root, inputs, options),
    rules: generated.forbidden.map((rule) => ({ name: rule.name, severity: rule.severity })),
    depcruiseVersion: version,
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

const main = async (argv) => {
  const options = parseArguments(argv)
  if (options.help) return process.stdout.write(helpText({ schemaVersion: SCHEMA_VERSION, nonCubeAreas: NON_CUBE_AREAS }))
  const payload = await collect(options)
  return process.stdout.write(options.json ? `${JSON.stringify(payload)}\n` : humanSummary(payload))
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  const failure = error instanceof ReportFailure
  process.stderr.write(`boundary-report: ${failure ? error.message : `unexpected failure: ${firstLine(error?.message ?? error)}`}\n`)
  process.exitCode = failure ? error.code : 1
}
