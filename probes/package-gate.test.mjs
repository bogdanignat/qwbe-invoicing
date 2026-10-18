import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { inspectPackageShapes } from "./package-gate-lib.mjs"

const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const withPackage = async (manifest, cubes, use) => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-package-gate-"))
  try {
    write(root, "qwbe-package.json", JSON.stringify({ ...manifest, cubes: Object.keys(cubes) }))
    for (const [path, source] of Object.entries(cubes)) {
      if (source !== undefined) write(root, `cubes/${path}/index.ts`, source)
      else mkdirSync(join(root, "cubes", path), { recursive: true })
    }
    return await use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const cubeSource = (manifest) => `export const cube = { manifest: ${JSON.stringify(manifest)} }\n`
const pack = { name: "invoicing-pack", kind: "plugin", summary: "Invoices" }

test("accepts a plugin package whose parent and child cubes declare themselves", async () => {
  const cubes = {
    invoicing: cubeSource({ name: "invoicing", summary: "Invoices", required: true }),
    "invoicing/payments": cubeSource({ name: "payments", parent: "invoicing", summary: "Payments", required: false }),
  }
  assert.deepEqual(await withPackage(pack, cubes, inspectPackageShapes), [
    { id: "qwbe-package.json", failures: [] },
    { id: "cubes/invoicing", failures: [] },
    { id: "cubes/invoicing/payments", failures: [] },
  ])
})

test("rejects a package that is not a described plugin", async () => {
  const cubes = { invoicing: cubeSource({ name: "invoicing", summary: "Invoices", required: true }) }
  const [shape] = await withPackage({ name: "", kind: "cube", summary: " " }, cubes, inspectPackageShapes)
  assert.deepEqual(shape.failures, ["package name is required", 'package kind must be "plugin"', "package summary is required"])
})

test("rejects a cube without a public entry or without a cube manifest", async () => {
  const shapes = await withPackage(pack, { invoicing: undefined, "invoicing/payments": "export const value = 1\n" }, inspectPackageShapes)
  assert.deepEqual(shapes.slice(1).map(({ failures }) => failures), [
    ["index.ts is required at the package root"],
    ["index.ts must export a cube with a manifest"],
  ])
})

test("rejects a cube manifest that misnames itself, its parent, its summary or whether it is required", async () => {
  const cubes = {
    invoicing: cubeSource({ name: "billing", parent: "root", summary: "Invoices", required: true }),
    "invoicing/payments": cubeSource({ name: "payments", parent: "billing", summary: "", required: "no" }),
  }
  assert.deepEqual((await withPackage(pack, cubes, inspectPackageShapes)).slice(1).map(({ failures }) => failures), [
    ["manifest name must match its directory", "manifest parent must name the enclosing cube"],
    ["manifest parent must name the enclosing cube", "manifest summary is required", "manifest required must be a boolean"],
  ])
})
