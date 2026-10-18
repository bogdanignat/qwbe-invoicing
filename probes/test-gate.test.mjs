import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { listCube } from "./cube-fixture.test-support.mjs"
import { inspectTestCoverage, untestedUnits } from "./test-gate-lib.mjs"

const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-test-gate-"))
const write = (root, path, content = "export const value = 1\n") => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const makeUnit = listCube

test("reports a production unit without tests", async () => {
  const root = fixture()
  try {
    makeUnit(root, "cubes/invoicing")
    write(root, "cubes/invoicing/index.ts")
    assert.deepEqual((await untestedUnits(root)).map((unit) => unit.id), ["cubes/invoicing"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("keeps recursively nested cube ownership independent", async () => {
  const root = fixture()
  try {
    makeUnit(root, "cubes/invoicing")
    write(root, "cubes/invoicing/index.ts")
    write(root, "cubes/invoicing/index.test.ts")
    makeUnit(root, "cubes/invoicing/cubes/reporting")
    write(root, "cubes/invoicing/cubes/reporting/index.ts")

    assert.deepEqual(await inspectTestCoverage(root), [
      { id: "cubes/invoicing", sourceCount: 1, testCount: 1 },
      { id: "cubes/invoicing/cubes/reporting", sourceCount: 1, testCount: 0 },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
