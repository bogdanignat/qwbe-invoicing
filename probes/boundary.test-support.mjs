import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import { listCube } from "./cube-fixture.test-support.mjs"

// Shared by the boundary gate and boundary-report tests: how the gate and the report
// are invoked and how a throwaway repository is laid out for them.
const probes = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = join(probes, "..")

const node = (script, args) =>
  spawnSync(process.execPath, [join(probes, script), ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
export const runReport = (...args) => node("boundary-report.mjs", args)
export const runGate = (...args) => node("boundary-gate.mjs", args)

export const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}

export const makeUnit = (root, path, source = "export const value = 1\n") => {
  listCube(root, path)
  write(root, `${path}/index.ts`, source)
}

export const withFixture = async (build, use) => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-boundary-test-"))
  try {
    build(root)
    return await use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
