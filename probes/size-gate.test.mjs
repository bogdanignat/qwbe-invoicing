import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath, URL } from "node:url"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { inspectSizes, sizeViolations, stripCommentsAndBlankLines } from "./size-gate-lib.mjs"

const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-size-gate-"))
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const makeUnit = (root, path) => write(root, `${path}/qwbe-package.json`, "{}\n")

test("counts code while preserving comment markers inside strings", () => {
  const source = '// removed\nconst url = "https://example.test/a"\n/* removed */\n\nconst value = 1\n'
  assert.equal(stripCommentsAndBlankLines(source), 'const url = "https://example.test/a"\nconst value = 1')
})

test("does not mistake comment markers inside regular expressions for comments", () => {
  const source = "const pattern = /https?:\\/\\/example[.]test/\nconst after = 1\n"
  assert.equal(stripCommentsAndBlankLines(source), source.trim())
})

test("keeps reading a file correctly after a template literal with substitutions", () => {
  // The scanner this used to use lost the grammar here: it read `//` in the
  // tail as a comment and then stopped recognising the real comment below it.
  const source = 'const url = `http://${host}//${path}`\n// removed\nconst after = 1\n'
  assert.equal(stripCommentsAndBlankLines(source), "const url = `http://${host}//${path}`\nconst after = 1")
})

test("counts a nested template literal as the code it is", () => {
  const source = 'const q = `a${`b/* not a comment */c`}d`\n/* removed */\nconst n = 2\n'
  assert.equal(stripCommentsAndBlankLines(source), "const q = `a${`b/* not a comment */c`}d`\nconst n = 2")
})

test("strips a comment that shares its line with the code before it", () => {
  // `getLeadingCommentRanges` only starts collecting at the start of the file
  // or after a line break, so these three were counted as code in full.
  assert.equal(stripCommentsAndBlankLines("const x = 1 // note\nconst y = 2\n"),
    "const x = 1 \nconst y = 2")
  assert.equal(stripCommentsAndBlankLines("const x = /* note */ 1\n"), "const x =  1")
  assert.equal(stripCommentsAndBlankLines("const x = 1 // last line, no newline"), "const x = 1 ")
})

test("strips a doc comment without counting the code it documents twice", () => {
  const source = "/** What it is.\n * Why it is.\n */\nexport const x = 1 // and how\n"
  assert.equal(stripCommentsAndBlankLines(source), "export const x = 1 ")
})

test("counts a shebang as the code it is, slashes included", () => {
  // `#!` is not a comment, and the two slashes in the interpreter path are not
  // one either — but they sit in the first token's trivia span, where every
  // other `//` does start a comment.
  const source = "#!/usr/bin/env node\nconst x = 1\n"
  assert.equal(stripCommentsAndBlankLines(source), source.trim())
  assert.equal(stripCommentsAndBlankLines("#!/usr/bin/env node // note\nconst x = 1\n"),
    "#!/usr/bin/env node // note\nconst x = 1")
})

test("rejects file, unit, and file-count cap violations", () => {
  const measurement = {
    files: [{ path: "cube/invoicing/index.ts", code: 11, raw: 11 }],
    units: [{ id: "cube/invoicing", files: 2, code: 11, raw: 11 }],
  }
  assert.deepEqual(sizeViolations(measurement, {
    maxCharsPerFile: 10,
    maxCharsPerUnit: 10,
    maxFilesPerUnit: 1,
  }), measurement)
})

test("measures nested cubes independently and excludes tests", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing")
    write(root, "cube/invoicing/index.ts", "export const parent = 1\n")
    write(root, "cube/invoicing/index.test.ts", "// tests are not production size\n")
    makeUnit(root, "cube/invoicing/cubes/reporting")
    write(root, "cube/invoicing/cubes/reporting/index.ts", "export const child = 2\n")

    const measurement = inspectSizes(root, ["cube"])
    assert.deepEqual(measurement.units.map(({ id, files }) => ({ id, files })), [
      { id: "cube/invoicing", files: 1 },
      { id: "cube/invoicing/cubes/reporting", files: 1 },
    ])
    assert.equal(measurement.files.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("measures host and browser sources without treating them as cubes", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing")
    write(root, "cube/invoicing/index.ts", "export const cube = 1\n")
    write(root, "standalone/api/new/handler.ts", "export const handler = 'over cap'\n")
    write(root, "web/src/View.tsx", 'export const View = () => <a href="https://example.test">Link</a>\n')
    write(root, "standalone/api/handler.test.ts", "test fixture")
    write(root, "standalone/api/handler.spec.ts", "test fixture")
    write(root, "standalone/api/handler.test-support.ts", "test fixture")
    write(root, "standalone/ui-dist/assets/app.js", "generated bundle")
    write(root, "standalone/ui-dist-source/real.ts", "export const real = 1\n")
    write(root, "web/dist/app.js", "generated bundle")
    write(root, "web/node_modules/library/index.js", "dependency")
    write(root, "web/.cache/generated.js", "generated bundle")
    write(root, "web/src/app.css", "stylesheet")
    symlinkSync(join(root, "standalone/api/new/handler.ts"), join(root, "web/linked.ts"))
    const measurement = inspectSizes(root, ["cube"], {
      fileRoots: ["standalone", "web", "standalone/api", "cube", "standalone/ui-dist/assets"],
      excludedDirectories: ["standalone/ui-dist"],
    })
    assert.deepEqual(measurement.files.map(({ path }) => path), [
      "cube/invoicing/index.ts",
      "standalone/api/new/handler.ts",
      "standalone/ui-dist-source/real.ts",
      "web/src/View.tsx",
    ])
    assert.deepEqual(measurement.units.map(({ id, files }) => ({ id, files })), [
      { id: "cube/invoicing", files: 1 },
    ])
    const violations = sizeViolations(measurement, { maxCharsPerFile: 25, maxCharsPerUnit: 40000, maxFilesPerUnit: 15 })
    assert.deepEqual(violations.files.map(({ path }) => path), ["standalone/api/new/handler.ts", "web/src/View.tsx"])
    assert.deepEqual(violations.units, [])
    assert.equal(measurement.files.find(({ path }) => path.endsWith("View.tsx")).code,
      'export const View = () => <a href="https://example.test">Link</a>'.length)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("refuses missing, non-directory and symbolic-link file roots", () => {
  const root = fixture()
  try {
    write(root, "web/src/index.ts", "export const value = 1\n")
    symlinkSync(join(root, "web"), join(root, "linked"))
    for (const fileRoot of ["missing", "web/src/index.ts", "linked", "linked/src", "../outside"]) {
      assert.throws(() => inspectSizes(root, [], { fileRoots: [fileRoot] }), /source root/i)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("size gate CLI fails on oversized host sources and invalid configured roots", () => {
  const root = fixture()
  try {
    for (const name of ["size-gate.mjs", "size-gate-lib.mjs", "source-tree.mjs"]) {
      write(root, `probes/${name}`, readFileSync(new URL(name, import.meta.url), "utf8"))
    }
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"))
    const config = { cubeRoots: [], sizeFileRoots: ["standalone"], caps: { maxCharsPerFile: 10, maxCharsPerUnit: 40000, maxFilesPerUnit: 15 } }
    write(root, "qwbe.config.json", JSON.stringify(config))
    write(root, "standalone/adapter.ts", "export const adapter = 1\n")
    const run = () => spawnSync(process.execPath, [join(root, "probes/size-gate.mjs")], { encoding: "utf8" })
    const overCap = run()
    assert.equal(overCap.status, 1)
    assert.match(overCap.stderr, /File over cap: standalone\/adapter.ts/)
    write(root, "standalone/adapter.ts", "const x=1")
    assert.equal(run().status, 0)
    write(root, "qwbe.config.json", JSON.stringify({ ...config, sizeFileRoots: ["missing"] }))
    const invalid = run()
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /Invalid size source root/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
