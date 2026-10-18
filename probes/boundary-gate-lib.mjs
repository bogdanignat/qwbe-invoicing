import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import configuration from "../dependency-cruiser.config.cjs"
import { cubeIsolationRules, cubeTreeRules, requiredCubeRules } from "./boundary-rules.mjs"
import { CUBES_DIRECTORY, discoverCubeUnits, loadCube } from "./source-tree.mjs"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const executable = join(repositoryRoot, "node_modules", ".bin", "depcruise")

// The single description of what a boundary cruise is: which roots are cruised, which
// cube units exist and the rule set that static configuration plus the dynamic cube
// rules add up to. The gate below runs it; read-only reporters reuse it unchanged so a
// report can never describe a different graph than the one the gate validates.
// `required` comes from the same manifests the package gate loads, never from a list.
export const boundaryGateInputs = async (root) => {
  const roots = [CUBES_DIRECTORY, "kernel", "frontend/src"].filter((path) => existsSync(join(root, path)))
  const units = await Promise.all((await discoverCubeUnits(root)).map(async (unit) =>
    ({ ...unit, required: (await loadCube(unit.directory))?.manifest?.required })))
  const generated = {
    ...configuration,
    forbidden: [...configuration.forbidden, ...cubeIsolationRules(units), ...cubeTreeRules(units), ...requiredCubeRules(units)],
  }
  return { roots, generated, units }
}

export const staticRuleCount = configuration.forbidden.length

export const runBoundaryGate = async (root) => {
  const { roots, generated } = await boundaryGateInputs(root)
  const temporary = mkdtempSync(join(tmpdir(), "qwbe-boundary-config-"))
  const configPath = join(temporary, "dependency-cruiser.config.cjs")

  try {
    writeFileSync(configPath, `module.exports = ${JSON.stringify(generated, null, 2)}\n`)
    const result = spawnSync(executable, [...roots, "--config", configPath], {
      cwd: root,
      encoding: "utf8",
    })
    return {
      exitCode: result.status ?? 1,
      output: result.stdout + result.stderr,
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
