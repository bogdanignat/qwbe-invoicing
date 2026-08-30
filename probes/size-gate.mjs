import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { inspectSizes, sizeViolations } from "./size-gate-lib.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const config = JSON.parse(readFileSync(join(root, "qwbe.config.json"), "utf8"))
const measurement = inspectSizes(root, config.cubeRoots)
const violations = sizeViolations(measurement, config.caps)

for (const unit of measurement.units) {
  console.log(`${unit.id}: ${unit.code} code characters across ${unit.files} production files`)
}
for (const file of violations.files) {
  console.error(`File over cap: ${file.path} has ${file.code}; cap is ${config.caps.maxCharsPerFile}.`)
}
for (const unit of violations.units) {
  console.error(
    `Unit over cap: ${unit.id} has ${unit.code} code characters and ${unit.files} files; caps are ${config.caps.maxCharsPerUnit} and ${config.caps.maxFilesPerUnit}.`,
  )
}

if (violations.files.length > 0 || violations.units.length > 0) {
  process.exitCode = 1
} else {
  console.log("Size gate passed.")
}
