import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

import { discoverCubeUnits } from "./source-tree.mjs"

export const inspectPackageShapes = (root, cubeRoots) => discoverCubeUnits(root, cubeRoots).map((unit) => {
  const failures = []
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(unit.directory, "qwbe-package.json"), "utf8"))
  } catch {
    failures.push("qwbe-package.json must contain valid JSON")
  }

  if (manifest !== undefined) {
    if (manifest.name !== basename(unit.directory)) failures.push("manifest name must match its directory")
    if (manifest.kind !== "cube") failures.push('manifest kind must be "cube"')
    if (typeof manifest.summary !== "string" || manifest.summary.trim() === "") failures.push("manifest summary is required")
  }
  if (!existsSync(join(unit.directory, "index.ts"))) failures.push("index.ts is required at the package root")

  return { id: unit.id, failures }
})
