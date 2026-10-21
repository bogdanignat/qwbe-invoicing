import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import configuration from "../dependency-cruiser.config.cjs"
import { cubeIsolationRules, cubeTreeRules, requiredCubeRules } from "./boundary-rules.mjs"
import { CUBES_DIRECTORY, discoverCubeUnits, loadCube } from "./source-tree.mjs"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
export const depcruiseExecutable = join(repositoryRoot, "node_modules", ".bin", "depcruise")

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

// Writes the generated rule set where depcruise can read it, cruises the gate's roots
// once and removes the config again. The gate and the read-only report both call this,
// so they can only differ in the output type they ask for, never in the graph.
export const cruiseBoundaries = (root, { roots, generated }, args = [], options = {}) => {
  const temporary = mkdtempSync(join(tmpdir(), "qwbe-boundary-config-"))
  const configPath = join(temporary, "dependency-cruiser.config.cjs")
  try {
    writeFileSync(configPath, `module.exports = ${JSON.stringify(generated, null, 2)}\n`)
    return spawnSync(depcruiseExecutable, [...roots, "--config", configPath, ...args], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      ...options,
    })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export const runBoundaryGate = async (root) => {
  const result = cruiseBoundaries(root, await boundaryGateInputs(root))
  return {
    exitCode: result.status ?? 1,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  }
}
