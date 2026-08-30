import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

const gate = join(dirname(fileURLToPath(import.meta.url)), "boundary-gate.mjs")
const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-boundary-gate-"))
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const makeUnit = (root, path, source = "export const value = 1\n") => {
  write(root, `${path}/qwbe-package.json`, "{}\n")
  write(root, `${path}/index.ts`, source)
}
const cruise = (root) => spawnSync(process.execPath, [gate, "--root", root], { encoding: "utf8" })
const output = (result) => result.stdout + result.stderr

test("accepts host composition through the public cube entry", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", "export const cube = {}\n")
    write(root, "standalone/main.ts", 'import { cube } from "../cube/invoicing/index.ts"\nvoid cube\n')
    const result = cruise(root)
    assert.equal(result.status, 0, output(result))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects direct runtime infrastructure access from cube code", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "node:fs"\nexport const cube = {}\n')
    const result = cruise(root)
    assert.notEqual(result.status, 0, output(result))
    assert.match(output(result), /cube-does-not-touch-runtime-infrastructure/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects imports between top-level cube siblings", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cube/reporting")
    const result = cruise(root)
    assert.notEqual(result.status, 0)
    assert.match(output(result), /no-cube-import-cube-invoicing-to-cube-reporting/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects imports across arbitrary nested cube ownership", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing")
    makeUnit(root, "cube/invoicing/cubes/reporting")
    makeUnit(
      root,
      "cube/invoicing/cubes/reporting/cubes/export",
      'import "../../index.ts"\nexport const nested = 1\n',
    )
    const result = cruise(root)
    assert.notEqual(result.status, 0)
    assert.match(output(result), /no-cube-import-cube-invoicing-cubes-reporting-cubes-export-to-cube-invoicing-cubes-reporting/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
