// The command-line contract of `probes/boundary-report.mjs`: the options it accepts,
// their defaults, its help text and the one failure type every refusal travels as.
// Nothing here can change the reported graph; the report's provenance fingerprints
// the inputs that can.
import { resolve } from "node:path"

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024
const SWITCHES = new Set(["--json", "--help"])
const VALUED = new Set(["--root", "--timeout", "--max-buffer"])

// Failures travel as a thrown value and leave through one place. Writing the exit
// code instead of calling process.exit keeps a multi-megabyte payload intact: stdout
// on a pipe flushes asynchronously and process.exit would cut it off mid-write.
export class ReportFailure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const fail = (code, message) => {
  throw new ReportFailure(code, message)
}

const positiveInteger = (given, flag, fallback) => {
  if (!given.has(flag)) return fallback
  const value = Number(given.get(flag))
  if (!Number.isInteger(value) || value <= 0) {
    fail(2, `${flag} expects a positive integer, got ${JSON.stringify(given.get(flag))}`)
  }
  return value
}

// Fail-closed: an argument the report does not know, or one given twice, is refused
// instead of ignored, so a typo like `--jsno` never yields a human summary that a
// consumer then tries to parse as the protocol.
export const parseArguments = (argv) => {
  const given = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!SWITCHES.has(flag) && !VALUED.has(flag)) {
      fail(2, `unknown argument ${JSON.stringify(flag)}; run with --help for the accepted options`)
    }
    if (given.has(flag)) fail(2, `${flag} was given more than once; pass it once`)
    if (SWITCHES.has(flag)) {
      given.set(flag, true)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) fail(2, `${flag} expects a value; run with --help for the accepted options`)
    given.set(flag, value)
    index += 1
  }
  return {
    help: given.has("--help"),
    json: given.has("--json"),
    root: given.has("--root") ? resolve(given.get("--root")) : undefined,
    timeout: positiveInteger(given, "--timeout", DEFAULT_TIMEOUT_MS),
    maxBuffer: positiveInteger(given, "--max-buffer", DEFAULT_MAX_BUFFER),
  }
}

export const helpText = ({ schemaVersion, nonCubeAreas }) => `qwbe boundary-report — read-only dependency graph of the boundary gate

Usage: node probes/boundary-report.mjs [--json] [--root <path>] [--timeout <ms>] [--max-buffer <bytes>]

Scope
  Cruises exactly the roots, options and rule set of \`pnpm gate:boundaries\`
  (cubes listed in qwbe-package.json plus kernel and frontend/src;
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
  Any other argument, or an option given twice, is refused as invalid usage.

Protocol (--json), schemaVersion ${schemaVersion}
  { schemaVersion, cruise, rules, depcruiseVersion, roots, areas, provenance }
  cruise      raw dependency-cruiser JSON output, unmodified
  rules       [{ name, severity }] of the full rule set actually used
  roots       cruised roots, relative to the cruised repository
  areas       [{ id, folder, group }]; cube units listed in the root
              qwbe-package.json plus ${nonCubeAreas.join(", ")}.
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
  On 1 and 2 stdout stays empty and stderr holds one line naming what failed,
  where, and what to do next: boundary-report: <what> (<where>); <next step>

Example
  node probes/boundary-report.mjs --json > /tmp/boundary.json
`
