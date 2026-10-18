import { existsSync } from "node:fs"
import { basename, join } from "node:path"

import { PACKAGE_MANIFEST, discoverCubeUnits, loadCube, readPackageManifest } from "./source-tree.mjs"

const isText = (value) => typeof value === "string" && value.trim() !== ""

const packageFailures = (manifest) => [
  ...(isText(manifest.name) ? [] : ["package name is required"]),
  ...(manifest.kind === "plugin" ? [] : ['package kind must be "plugin"']),
  ...(isText(manifest.summary) ? [] : ["package summary is required"]),
]

// The closest listed ancestor is the parent a child cube has to name.
const parentOf = (unit, units) => units
  .filter((candidate) => unit.id.startsWith(`${candidate.id}/`))
  .sort((left, right) => right.id.length - left.id.length)[0]

const cubeFailures = async (unit, units) => {
  const entry = join(unit.directory, "index.ts")
  if (!existsSync(entry)) return ["index.ts is required at the package root"]
  const manifest = (await loadCube(unit.directory))?.manifest
  if (typeof manifest !== "object" || manifest === null) return ["index.ts must export a cube with a manifest"]

  const parent = parentOf(unit, units)
  return [
    ...(manifest.name === basename(unit.directory) ? [] : ["manifest name must match its directory"]),
    ...(manifest.parent === (parent === undefined ? undefined : basename(parent.directory)) ? [] : ["manifest parent must name the enclosing cube"]),
    ...(isText(manifest.summary) ? [] : ["manifest summary is required"]),
    ...(typeof manifest.required === "boolean" ? [] : ["manifest required must be a boolean"]),
  ]
}

export const inspectPackageShapes = async (root) => {
  const units = await discoverCubeUnits(root)
  return [
    { id: PACKAGE_MANIFEST, failures: packageFailures(readPackageManifest(root)) },
    ...await Promise.all(units.map(async (unit) => ({ id: unit.id, failures: await cubeFailures(unit, units) }))),
  ]
}
