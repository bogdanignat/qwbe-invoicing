import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { inspectPackageShapes } from "./package-gate-lib.mjs"

const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-package-gate-"))
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}

test("accepts a complete cube package root", () => {
  const root = fixture()
  try {
    write(root, "cube/invoicing/qwbe-package.json", JSON.stringify({ name: "invoicing", kind: "cube", summary: "Invoices" }))
    write(root, "cube/invoicing/index.ts", "export const cube = {}\n")
    assert.deepEqual(inspectPackageShapes(root, ["cube"]), [{ id: "cube/invoicing", failures: [] }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects a mismatched package without a public entry", () => {
  const root = fixture()
  try {
    write(root, "cube/invoicing/qwbe-package.json", JSON.stringify({ name: "billing", kind: "plugin", summary: "" }))
    assert.deepEqual(inspectPackageShapes(root, ["cube"])[0]?.failures, [
      "manifest name must match its directory",
      'manifest kind must be "cube"',
      "manifest summary is required",
      "index.ts is required at the package root",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
