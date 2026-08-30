import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { inspectTestCoverage } from "./test-gate-lib.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const config = JSON.parse(readFileSync(join(root, "qwbe.config.json"), "utf8"))
const units = inspectTestCoverage(root, config.cubeRoots)
const failures = units.filter((unit) => unit.sourceCount > 0 && unit.testCount === 0)

for (const unit of units) {
  const status = unit.sourceCount === 0 || unit.testCount > 0 ? "✓" : "✗"
  console.log(`${status} ${unit.id}: ${unit.sourceCount} source, ${unit.testCount} test files`)
}

if (failures.length > 0) {
  console.error(`Unit-test gate failed: ${failures.map((unit) => unit.id).join(", ")} have production code but no tests.`)
  process.exitCode = 1
} else {
  console.log("Unit-test gate passed.")
}
