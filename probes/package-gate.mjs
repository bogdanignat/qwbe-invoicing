import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { inspectPackageShapes } from "./package-gate-lib.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const packages = await inspectPackageShapes(root)
const failures = packages.filter((unit) => unit.failures.length > 0)

for (const unit of packages) {
  if (unit.failures.length === 0) console.log(`✓ ${unit.id}`)
  else for (const failure of unit.failures) console.error(`✗ ${unit.id}: ${failure}`)
}

if (failures.length > 0) process.exitCode = 1
else console.log("Package-shape gate passed.")
