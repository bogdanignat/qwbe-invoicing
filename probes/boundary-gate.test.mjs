import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

const gate = join(dirname(fileURLToPath(import.meta.url)), "boundary-gate.mjs")
const fixture = () => mkdtempSync(join(tmpdir(), "qwbe-boundary-gate-"))
const write = (root, path, content) => {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content)
}
const makeUnit = (root, path, source = "export const value = 1\n") => {
  write(root, `${path}/qwbe-package.json`, "{}\n")
  write(root, `${path}/index.ts`, source)
}
const cruise = (root) => spawnSync(process.execPath, [gate, "--root", root], { encoding: "utf8" })
const output = (result) => result.stdout + result.stderr

test("accepts host composition through the public cube entry", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", "export const cube = {}\n")
    write(root, "standalone/main.ts", 'import { cube } from "../cube/invoicing/index.ts"\nvoid cube\n')
    const result = cruise(root)
    assert.equal(result.status, 0, output(result))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects direct runtime infrastructure access from cube code", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "node:fs"\nexport const cube = {}\n')
    const result = cruise(root)
    assert.notEqual(result.status, 0, output(result))
    assert.match(output(result), /cube-does-not-touch-runtime-infrastructure/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects imports between top-level cube siblings", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cube/reporting")
    const result = cruise(root)
    assert.notEqual(result.status, 0)
    assert.match(output(result), /no-cube-import-cube-invoicing-to-cube-reporting/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("accepts imports between a parent cube and its child cubes", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing", 'import "./reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cube/invoicing/reporting", 'import "../shared.ts"\nexport const reporting = 1\n')
    write(root, "cube/invoicing/shared.ts", "export const shared = 1\n")
    const result = cruise(root)
    assert.equal(result.status, 0, output(result))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects imports from a nested child cube into another top-level cube", () => {
  const root = fixture()
  try {
    makeUnit(root, "cube/invoicing")
    makeUnit(root, "cube/invoicing/cubes/reporting", 'import "../../../payments/index.ts"\nexport const nested = 1\n')
    makeUnit(root, "cube/payments")
    const result = cruise(root)
    assert.notEqual(result.status, 0)
    assert.match(output(result), /no-cube-import-cube-invoicing-cubes-reporting-to-cube-payments/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const withFixture = (build) => {
  const root = fixture()
  try {
    build(root)
    return cruise(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// The PostgreSQL driver is infrastructure, so the same rule that keeps `node:fs`
// out of a cube keeps `pg` out. Three install shapes are asserted because the
// rule matches the path dependency-cruiser resolved to, not the specifier the
// source wrote: a bare name (nothing resolved it), a flat `node_modules/pg`, and
// the `.pnpm` store this repository actually produces — pnpm links
// `node_modules/pg` at the store and the cruiser follows the symlink, so a rule
// written only for the flat form would pass while the import was real.
const installFlat = (root, name, main = "index.js") => {
  write(root, `node_modules/${name}/package.json`, `{"name":"${name}","version":"1.0.0","main":"${main}"}\n`)
  write(root, `node_modules/${name}/${main}`, "module.exports = {}\n")
}
const installThroughStore = (root, name, version) => {
  const inner = `node_modules/.pnpm/${name}@${version}/node_modules/${name}`
  write(root, `${inner}/package.json`, `{"name":"${name}","version":"${version}","main":"lib/index.js"}\n`)
  write(root, `${inner}/lib/index.js`, "module.exports = {}\n")
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(`.pnpm/${name}@${version}/node_modules/${name}`, join(root, "node_modules", name))
}

test("rejects the PostgreSQL driver from cube code in every install shape", () => {
  for (const specifier of ["pg", "pg-pool", "pg-native", "pg-cursor"]) {
    const unresolved = withFixture((root) => {
      makeUnit(root, "cube/invoicing", `import "${specifier}"\nexport const cube = {}\n`)
    })
    assert.notEqual(unresolved.status, 0, specifier)
    assert.match(output(unresolved), /cube-does-not-touch-runtime-infrastructure/)
  }
  const flat = withFixture((root) => {
    installFlat(root, "pg")
    makeUnit(root, "cube/invoicing", 'import "pg"\nexport const cube = {}\n')
  })
  assert.notEqual(flat.status, 0, output(flat))
  assert.match(output(flat), /cube-does-not-touch-runtime-infrastructure/)
  assert.match(output(flat), /node_modules\/pg\//)
  const throughStore = withFixture((root) => {
    installThroughStore(root, "pg", "8.23.0")
    makeUnit(root, "cube/invoicing", 'import "pg"\nexport const cube = {}\n')
  })
  assert.notEqual(throughStore.status, 0, output(throughStore))
  assert.match(output(throughStore), /node_modules\/[.]pnpm\/pg@8[.]23[.]0\/node_modules\/pg\//)
})

test("still lets cube code import an unrelated npm package", () => {
  const flat = withFixture((root) => {
    installFlat(root, "effect")
    makeUnit(root, "cube/invoicing", 'import "effect"\nexport const cube = {}\n')
  })
  assert.equal(flat.status, 0, output(flat))
  const throughStore = withFixture((root) => {
    installThroughStore(root, "effect", "3.21.2")
    makeUnit(root, "cube/invoicing", 'import "effect"\nexport const cube = {}\n')
  })
  assert.equal(throughStore.status, 0, output(throughStore))
})

test("lets a parent reach a child only through the child's exact index, types included", () => {
  const base = (root, parentSource) => {
    makeUnit(root, "cube/invoicing", parentSource)
    makeUnit(root, "cube/invoicing/customers", 'export type { Customer } from "./domain/customer.ts"\n')
    write(root, "cube/invoicing/customers/domain/customer.ts", "export interface Customer { readonly id: string }\n")
  }
  const allowed = withFixture((root) => base(root, 'export type { Customer } from "./customers/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  for (const parentSource of [
    'export type { Customer } from "./customers/domain/customer.ts"\n',
    'import type { Customer } from "./customers/domain/customer.ts"\nexport type Alias = Customer\n',
  ]) {
    const rejected = withFixture((root) => base(root, parentSource))
    assert.notEqual(rejected.status, 0, parentSource)
    assert.match(output(rejected), /cube-tree-cube-invoicing-to-cube-invoicing-customers-only-through-index/)
  }
})

test("lets siblings meet only through their indexes", () => {
  const base = (root, draftsSource) => {
    makeUnit(root, "cube/invoicing")
    makeUnit(root, "cube/invoicing/customers", 'export { find } from "./application/find.ts"\n')
    write(root, "cube/invoicing/customers/application/find.ts", "export const find = 1\n")
    makeUnit(root, "cube/invoicing/drafts", draftsSource)
  }
  const allowed = withFixture((root) => base(root, 'export { find } from "../customers/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  const rejected = withFixture((root) => base(root, 'export { find } from "../customers/application/find.ts"\n'))
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /cube-tree-cube-invoicing-drafts-to-cube-invoicing-customers-only-through-index/)
})

test("lets nested children use every ancestor kernel but no one else's interior", () => {
  const base = (root, parentSource) => {
    write(root, "cube/invoicing/kernel.ts", "export const kernel = 1\n")
    makeUnit(root, "cube/invoicing", parentSource)
    write(root, "cube/invoicing/issuance/shared.ts", "export const shared = 1\n")
    makeUnit(root, "cube/invoicing/issuance", 'export { numbering } from "./numbering/index.ts"\n')
    makeUnit(root, "cube/invoicing/issuance/numbering",
      'import { kernel } from "../../kernel.ts"\nimport { shared } from "../shared.ts"\nexport const numbering = kernel + shared\n')
    write(root, "cube/invoicing/issuance/numbering/series.ts", "export const series = 1\n")
  }
  const allowed = withFixture((root) => base(root, 'export { numbering } from "./issuance/numbering/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  const rejected = withFixture((root) => base(root, 'export { series } from "./issuance/numbering/series.ts"\n'))
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /cube-tree-cube-invoicing-to-cube-invoicing-issuance-numbering-only-through-index/)
  const parentIntoChildInterior = withFixture((root) => {
    base(root, "export const invoicing = 1\n")
    write(root, "cube/invoicing/issuance/leak.ts", 'export { series } from "./numbering/series.ts"\n')
  })
  assert.notEqual(parentIntoChildInterior.status, 0)
  assert.match(output(parentIntoChildInterior), /cube-tree-cube-invoicing-issuance-to-cube-invoicing-issuance-numbering-only-through-index/)
})

// The kernel port once reached into corrections and issuance for their document types;
// each child now owns its port, so those edges are refused like any other interior import.
const kernelPortFixture = (root, ports, support) => {
  makeUnit(root, "cube/invoicing")
  write(root, "cube/invoicing/application/ports.ts", ports)
  write(root, "cube/invoicing/application/memory-store.test-support.ts", support)
  makeUnit(root, "cube/invoicing/corrections", 'export type { Correction } from "./domain/corrections.ts"\n')
  write(root, "cube/invoicing/corrections/domain/corrections.ts", "export interface Correction { readonly id: string }\n")
  makeUnit(root, "cube/invoicing/issuance", 'export type { Proforma } from "./domain/proforma.ts"\n')
  write(root, "cube/invoicing/issuance/domain/proforma.ts", "export interface Proforma { readonly id: string }\n")
}

test("refuses the kernel port and its test store reaching into a child's interior", () => {
  const throughIndex = withFixture((root) => kernelPortFixture(root,
    "export type Ports = string\n",
    'import type { Correction } from "../corrections/index.ts"\nimport type { Proforma } from "../issuance/index.ts"\nexport type Stored = Correction | Proforma\n'))
  assert.equal(throughIndex.status, 0, output(throughIndex))
  const portIntoCorrections = withFixture((root) => kernelPortFixture(root,
    'import type { Correction } from "../corrections/domain/corrections.ts"\nexport type Ports = Correction\n',
    "export type Stored = string\n"))
  assert.notEqual(portIntoCorrections.status, 0)
  assert.match(output(portIntoCorrections), /cube-tree-cube-invoicing-to-cube-invoicing-corrections-only-through-index:/)
  const portIntoIssuance = withFixture((root) => kernelPortFixture(root,
    'import type { Proforma } from "../issuance/domain/proforma.ts"\nexport type Ports = Proforma\n',
    "export type Stored = string\n"))
  assert.notEqual(portIntoIssuance.status, 0)
  assert.match(output(portIntoIssuance), /cube-tree-cube-invoicing-to-cube-invoicing-issuance-only-through-index:/)
  const storeIntoIssuance = withFixture((root) => kernelPortFixture(root,
    "export type Ports = string\n",
    'import type { Proforma } from "../issuance/domain/proforma.ts"\nexport type Stored = Proforma\n'))
  assert.notEqual(storeIntoIssuance.status, 0)
  assert.match(output(storeIntoIssuance), /cube-tree-cube-invoicing-to-cube-invoicing-issuance-only-through-index:/)
})

test("still refuses import cycles inside one cube tree", () => {
  const result = withFixture((root) => {
    makeUnit(root, "cube/invoicing", 'import { child } from "./reporting/index.ts"\nexport const parent = child\n')
    makeUnit(root, "cube/invoicing/reporting", 'import { parent } from "../index.ts"\nexport const child = 1\nvoid parent\n')
  })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /no-circular-dependencies/)
})
