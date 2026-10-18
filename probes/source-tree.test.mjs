import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { discoverCubeUnits } from "./source-tree.mjs"

const probes = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(probes, "..")
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
const withRoot = async (build, use) => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-source-tree-"))
  try {
    build(root)
    return await use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const manifest = (cubes) => JSON.stringify({ name: "invoicing-pack", kind: "plugin", summary: "Invoices", cubes })
const cube = (root, path) => write(root, `cubes/${path}/index.ts`, "export const cube = {}\n")
const twoCubes = (root) => {
  cube(root, "invoicing")
  cube(root, "invoicing/payments")
}
const refuses = (build, pattern) => withRoot(build, (root) => assert.rejects(discoverCubeUnits(root), pattern))

test("lists exactly the declared cubes, children included, and not their contracts", async () => {
  await withRoot((root) => {
    twoCubes(root)
    write(root, "cubes/invoicing/contracts/index.ts", 'export * from "./host.ts"\n')
    write(root, "cubes/invoicing/contracts/host.ts", "export type Host = string\nexport const hostName = \"host\"\n")
    write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments"]))
  }, async (root) => {
    assert.deepEqual((await discoverCubeUnits(root)).map(({ id, directory }) => ({ id, directory })), [
      { id: "cubes/invoicing", directory: join(root, "cubes", "invoicing") },
      { id: "cubes/invoicing/payments", directory: join(root, "cubes", "invoicing", "payments") },
    ])
  })
})

test("refuses a repository without the package manifest", async () => {
  await refuses(twoCubes, /qwbe-package.json must be a regular file/)
})

test("refuses a package that lists no cube", async () => {
  for (const cubes of [[], undefined, "invoicing"]) {
    await refuses((root) => write(root, "qwbe-package.json", JSON.stringify({ name: "invoicing-pack", kind: "plugin", cubes })),
      /must list at least one cube/)
  }
})

test("refuses a cube on disk that the package leaves out", async () => {
  await refuses((root) => {
    twoCubes(root)
    write(root, "qwbe-package.json", manifest(["invoicing"]))
  }, /cubes\/invoicing\/payments declares a cube but is not listed/)
})

test("refuses an unlisted cube that only re-exports its definition", async () => {
  for (const entry of ['export { cube } from "./cube.ts"\n', 'export * from "./cube.ts"\n']) {
    await refuses((root) => {
      twoCubes(root)
      write(root, "cubes/invoicing/reporting/cube.ts", "export const cube = { manifest: { name: \"reporting\" } }\n")
      write(root, "cubes/invoicing/reporting/index.ts", entry)
      write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments"]))
    }, /cubes\/invoicing\/reporting declares a cube but is not listed/)
  }
})

test("refuses a cube listed twice", async () => {
  await refuses((root) => {
    twoCubes(root)
    write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments", "invoicing"]))
  }, /duplicate cube invoicing/)
})

test("refuses paths that escape cubes/, are absolute or are not plain segments", async () => {
  for (const path of ["../kernel", "invoicing/../kernel", "/cubes/invoicing", "./invoicing", "invoicing/", "invoicing//payments", "Invoicing", "", 7]) {
    await refuses((root) => {
      twoCubes(root)
      write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments", path]))
    }, /invalid cube path/)
  }
})

test("refuses a listed cube or a manifest that is missing or reached through a symbolic link", async () => {
  await refuses((root) => {
    twoCubes(root)
    write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments", "invoicing/missing"]))
  }, /cubes\/invoicing\/missing is not a real directory/)
  await refuses((root) => {
    twoCubes(root)
    cube(root, "elsewhere")
    symlinkSync(join(root, "cubes", "elsewhere"), join(root, "cubes", "invoicing", "linked"))
    write(root, "qwbe-package.json", manifest(["invoicing", "invoicing/payments", "elsewhere", "invoicing/linked"]))
  }, /cubes\/invoicing\/linked is not a real directory/)
  await refuses((root) => {
    twoCubes(root)
    write(root, "elsewhere.json", manifest(["invoicing", "invoicing/payments"]))
    symlinkSync(join(root, "elsewhere.json"), join(root, "qwbe-package.json"))
  }, /qwbe-package.json must be a regular file/)
})

// Every gate takes its units from the same discovery, so none of them may pass a
// repository whose inventory is missing: zero units would otherwise be a green gate.
test("every cube gate fails closed without the package manifest", async () => {
  await withRoot((root) => {
    for (const name of readdirSync(probes).filter((file) => file.endsWith(".mjs"))) {
      write(root, `probes/${name}`, readFileSync(join(probes, name), "utf8"))
    }
    write(root, "qwbe.config.json", JSON.stringify({ sizeFileRoots: [], caps: { maxCharsPerFile: 1, maxCharsPerUnit: 1, maxFilesPerUnit: 1 } }))
    copyFileSync(join(repositoryRoot, "dependency-cruiser.config.cjs"), join(root, "dependency-cruiser.config.cjs"))
    symlinkSync(join(repositoryRoot, "node_modules"), join(root, "node_modules"))
    twoCubes(root)
  }, (root) => {
    for (const gate of ["package-gate.mjs", "test-gate.mjs", "size-gate.mjs", "boundary-gate.mjs"]) {
      const result = spawnSync(process.execPath, [join(root, "probes", gate), "--root", root], { encoding: "utf8" })
      assert.notEqual(result.status, 0, gate)
      assert.match(result.stderr, /qwbe-package.json must be a regular file/, gate)
    }
  })
})
