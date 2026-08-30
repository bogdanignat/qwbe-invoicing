import assert from "node:assert/strict"
import test from "node:test"

import { HttpApiGroup } from "@effect/platform"

import { cube } from "./index.ts"

void test("exports a minimal authenticated QWBE cube definition", () => {
  assert.equal(cube.manifest.name, "invoicing")
  assert.equal(cube.manifest.requiresAuth, true)
  assert.equal(cube.manifest.permissions.length, 7)

  const parts = cube.create()
  assert.equal(HttpApiGroup.isHttpApiGroup(parts.group), true)
  assert.deepEqual(parts.handlers, {})
})
