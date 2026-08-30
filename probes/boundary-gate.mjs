import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runBoundaryGate } from "./boundary-gate-lib.mjs"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const rootArgument = process.argv.indexOf("--root")
const root = rootArgument >= 0 && process.argv[rootArgument + 1] !== undefined
  ? resolve(process.argv[rootArgument + 1])
  : repositoryRoot
const config = JSON.parse(readFileSync(join(repositoryRoot, "qwbe.config.json"), "utf8"))

process.chdir(root)
const result = await runBoundaryGate(root, config.cubeRoots)

if (typeof result.output === "string" && result.output.trim() !== "") {
  console.log(result.output)
}
process.exitCode = result.exitCode
