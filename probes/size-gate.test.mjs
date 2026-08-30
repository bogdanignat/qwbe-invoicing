import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
