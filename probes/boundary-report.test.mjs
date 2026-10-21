import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { makeUnit, repositoryRoot, runReport, withFixture } from "./boundary.test-support.mjs"

// Every refusal leaves the same way: no protocol on stdout, one prefixed line on stderr.
const assertRefused = (result, status, message) => {
  assert.equal(result.status, status, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr.trim().split("\n").length, 1, result.stderr)
  assert.match(result.stderr, /^boundary-report: /)
  assert.match(result.stderr, message)
}

test("refuses an unknown argument instead of ignoring it", () => {
  assertRefused(runReport("--jsno"), 2, /unknown argument "--jsno"; run with --help/)
  assertRefused(runReport("--json", "cubes"), 2, /unknown argument "cubes"/)
  assertRefused(runReport("--root=."), 2, /unknown argument "--root=\."/)
  assertRefused(runReport("--help", "--verbose"), 2, /unknown argument "--verbose"/)
})

test("refuses an option given twice", () => {
  assertRefused(runReport("--json", "--json"), 2, /--json was given more than once; pass it once/)
  assertRefused(runReport("--timeout", "5", "--timeout", "6"), 2, /--timeout was given more than once/)
})

test("refuses malformed option values as invalid usage", () => {
  assertRefused(runReport("--timeout", "abc"), 2, /--timeout expects a positive integer, got "abc"/)
  assertRefused(runReport("--max-buffer", "0"), 2, /--max-buffer expects a positive integer, got "0"/)
  assertRefused(runReport("--root"), 2, /--root expects a value; run with --help/)
  assertRefused(runReport("--root", "--json"), 2, /--root expects a value/)
})

test("refuses a root that is not a directory, saying which path", () => {
  const missing = join(repositoryRoot, "no-such-checkout")
  assertRefused(runReport("--root", missing), 2,
    new RegExp(`--root ${missing} is not a directory; pass the path of a repository checkout`))
  assertRefused(runReport("--root", join(repositoryRoot, "package.json")), 2, /package\.json is not a directory/)
})

test("names the cube tree, the root and the fix when the manifests cannot be read", async () => {
  const empty = await withFixture(() => {}, (root) => ({ root, result: runReport("--json", "--root", root) }))
  assertRefused(empty.result, 1, new RegExp(
    `cannot read the cube tree: qwbe-package.json must be a regular file at the repository root \\(${empty.root}\\); fix qwbe-package.json`))

  const broken = await withFixture((root) => {
    makeUnit(root, "cubes/invoicing")
    writeFileSync(join(root, "qwbe-package.json"), "{")
  }, (root) => runReport("--json", "--root", root))
  assertRefused(broken, 1,
    /cannot read the cube tree: qwbe-package\.json is not valid JSON: .*; fix qwbe-package\.json or the cube it names, then rerun/)
})

test("leaves a failure outside the manifest unexpected, without the manifest advice", async () => {
  const result = await withFixture((root) => {
    makeUnit(root, "cubes/invoicing", 'throw new Error("cube index exploded")\n')
  }, (root) => runReport("--json", "--root", root))
  assertRefused(result, 1, /^boundary-report: unexpected failure: cube index exploded$/m)
  assert.doesNotMatch(result.stderr, /qwbe-package\.json/)
})

test("names the cap that stopped depcruise and the option that raises it", () => {
  const timedOut = runReport("--json", "--timeout", "1")
  assertRefused(timedOut, 1,
    new RegExp(`depcruise exceeded the 1ms timeout \\(cruising ${repositoryRoot}\\); rerun with a larger --timeout`))
  assert.ok(!/[A-Z_]{3,}=/.test(timedOut.stderr), "no environment in the message")

  assertRefused(runReport("--json", "--max-buffer", "1000"), 1,
    /depcruise output exceeded the 1000 byte cap \(cruising .+\); rerun with a larger --max-buffer/)
})

test("prints human counts without the protocol, and documents itself", () => {
  const human = runReport()
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /^roots {12}cubes kernel frontend\/src$/m)
  assert.match(human.stdout, /^modules {10}\d+$/m)
  assert.match(human.stdout, /^violations {7}\d+ \(error \d+, warn \d+, info \d+\)$/m)
  assert.ok(!human.stdout.includes("schemaVersion"))
  assert.ok(!/no dependency violations found|✔/.test(human.stdout), "it never reports gate success")

  const help = runReport("--help")
  assert.equal(help.status, 0)
  assert.match(help.stdout, /read-only/)
  assert.match(help.stdout, /schemaVersion, cruise, rules, depcruiseVersion, roots, areas, provenance/)
  assert.match(help.stdout, /plus kernel, frontend\/src\./)
  assert.match(help.stdout, /longest matching prefix/)
  assert.match(help.stdout, /0 {2}graph collected, violations included/)
  assert.match(help.stdout, /Any other argument, or an option given twice, is refused/)
  assert.match(help.stdout, /boundary-report: <what> \(<where>\); <next step>/)
})
