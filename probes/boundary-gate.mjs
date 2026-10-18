import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runBoundaryGate } from "./boundary-gate-lib.mjs"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const rootArgument = process.argv.indexOf("--root")
const root = rootArgument >= 0 && process.argv[rootArgument + 1] !== undefined
  ? resolve(process.argv[rootArgument + 1])
  : repositoryRoot

process.chdir(root)
const result = await runBoundaryGate(root)

if (typeof result.output === "string" && result.output.trim() !== "") {
  console.log(result.output)
}
process.exitCode = result.exitCode
