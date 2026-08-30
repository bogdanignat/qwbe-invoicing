import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const expected = packageJson.engines?.node
const actual = process.versions.node

if (expected !== actual) {
  console.error(`Node version mismatch: expected ${expected}, running ${actual}.`)
  process.exitCode = 1
} else {
  console.log(`Node version gate passed (${actual}).`)
}
