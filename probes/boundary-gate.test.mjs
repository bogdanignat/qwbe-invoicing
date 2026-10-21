import assert from "node:assert/strict"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { makeUnit, runGate, withFixture, write } from "./boundary.test-support.mjs"

const cruise = (root) => runGate("--root", root)
const gateOn = (build) => withFixture(build, cruise)
const output = (result) => result.stdout + result.stderr

test("accepts host composition through the public cube entry", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing", "export const cube = {}\n")
    write(root, "kernel/main.ts", 'import { cube } from "../cubes/invoicing/index.ts"\nvoid cube\n')
  })
  assert.equal(result.status, 0, output(result))
})

test("rejects direct runtime infrastructure access from cube code", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing", 'import "node:fs"\nexport const cube = {}\n')
  })
  assert.notEqual(result.status, 0, output(result))
  assert.match(output(result), /cube-does-not-touch-runtime-infrastructure/)
})

test("rejects imports between top-level cube siblings", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing", 'import "../reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cubes/reporting")
  })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /no-cube-import-cubes-invoicing-to-cubes-reporting/)
})

test("accepts imports between a parent cube and its child cubes", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing", 'import "./reporting/index.ts"\nexport const invoice = 1\n')
    makeUnit(root, "cubes/invoicing/reporting", 'import "../shared.ts"\nexport const reporting = 1\n')
    write(root, "cubes/invoicing/shared.ts", "export const shared = 1\n")
  })
  assert.equal(result.status, 0, output(result))
})

test("rejects imports from a nested child cube into another top-level cube", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing")
    makeUnit(root, "cubes/invoicing/cubes/reporting", 'import "../../../billing/index.ts"\nexport const nested = 1\n')
    makeUnit(root, "cubes/billing")
  })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /no-cube-import-cubes-invoicing-cubes-reporting-to-cubes-billing/)
})

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

test("rejects the PostgreSQL driver from cube code in every install shape", async () => {
  for (const specifier of ["pg", "pg-pool", "pg-native", "pg-cursor"]) {
    // In a file of its own: the gate loads index.ts to read the manifest, and an
    // unresolved driver there would stop it before the cruise could name the rule.
    const unresolved = await gateOn((root) => {
      makeUnit(root, "cubes/invoicing", "export const cube = {}\n")
      write(root, "cubes/invoicing/driver.ts", `import "${specifier}"\n`)
    })
    assert.notEqual(unresolved.status, 0, specifier)
    assert.match(output(unresolved), /cube-does-not-touch-runtime-infrastructure/)
  }
  const flat = await gateOn((root) => {
    installFlat(root, "pg")
    makeUnit(root, "cubes/invoicing", 'import "pg"\nexport const cube = {}\n')
  })
  assert.notEqual(flat.status, 0, output(flat))
  assert.match(output(flat), /cube-does-not-touch-runtime-infrastructure/)
  assert.match(output(flat), /node_modules\/pg\//)
  const throughStore = await gateOn((root) => {
    installThroughStore(root, "pg", "8.23.0")
    makeUnit(root, "cubes/invoicing", 'import "pg"\nexport const cube = {}\n')
  })
  assert.notEqual(throughStore.status, 0, output(throughStore))
  assert.match(output(throughStore), /node_modules\/[.]pnpm\/pg@8[.]23[.]0\/node_modules\/pg\//)
})

test("still lets cube code import an unrelated npm package", async () => {
  const flat = await gateOn((root) => {
    installFlat(root, "effect")
    makeUnit(root, "cubes/invoicing", 'import "effect"\nexport const cube = {}\n')
  })
  assert.equal(flat.status, 0, output(flat))
  const throughStore = await gateOn((root) => {
    installThroughStore(root, "effect", "3.21.2")
    makeUnit(root, "cubes/invoicing", 'import "effect"\nexport const cube = {}\n')
  })
  assert.equal(throughStore.status, 0, output(throughStore))
})

test("lets a parent reach a child only through the child's exact index, types included", async () => {
  const base = (root, parentSource) => {
    makeUnit(root, "cubes/invoicing", parentSource)
    makeUnit(root, "cubes/invoicing/customers", 'export type { Customer } from "./domain/customer.ts"\n')
    write(root, "cubes/invoicing/customers/domain/customer.ts", "export interface Customer { readonly id: string }\n")
  }
  const allowed = await gateOn((root) => base(root, 'export type { Customer } from "./customers/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  for (const parentSource of [
    'export type { Customer } from "./customers/domain/customer.ts"\n',
    'import type { Customer } from "./customers/domain/customer.ts"\nexport type Alias = Customer\n',
  ]) {
    const rejected = await gateOn((root) => base(root, parentSource))
    assert.notEqual(rejected.status, 0, parentSource)
    assert.match(output(rejected), /cube-tree-cubes-invoicing-to-cubes-invoicing-customers-only-through-index/)
  }
})

test("lets siblings meet only through their indexes", async () => {
  const base = (root, draftsSource) => {
    makeUnit(root, "cubes/invoicing")
    makeUnit(root, "cubes/invoicing/customers", 'export { find } from "./application/find.ts"\n')
    write(root, "cubes/invoicing/customers/application/find.ts", "export const find = 1\n")
    makeUnit(root, "cubes/invoicing/drafts", draftsSource)
  }
  const allowed = await gateOn((root) => base(root, 'export { find } from "../customers/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  const rejected = await gateOn((root) => base(root, 'export { find } from "../customers/application/find.ts"\n'))
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /cube-tree-cubes-invoicing-drafts-to-cubes-invoicing-customers-only-through-index/)
})

test("lets nested children use every ancestor kernel but no one else's interior", async () => {
  const base = (root, parentSource) => {
    write(root, "cubes/invoicing/kernel.ts", "export const kernel = 1\n")
    makeUnit(root, "cubes/invoicing", parentSource)
    write(root, "cubes/invoicing/issuance/shared.ts", "export const shared = 1\n")
    makeUnit(root, "cubes/invoicing/issuance", 'export { numbering } from "./numbering/index.ts"\n')
    makeUnit(root, "cubes/invoicing/issuance/numbering",
      'import { kernel } from "../../kernel.ts"\nimport { shared } from "../shared.ts"\nexport const numbering = kernel + shared\n')
    write(root, "cubes/invoicing/issuance/numbering/series.ts", "export const series = 1\n")
  }
  const allowed = await gateOn((root) => base(root, 'export { numbering } from "./issuance/numbering/index.ts"\n'))
  assert.equal(allowed.status, 0, output(allowed))
  const rejected = await gateOn((root) => base(root, 'export { series } from "./issuance/numbering/series.ts"\n'))
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /cube-tree-cubes-invoicing-to-cubes-invoicing-issuance-numbering-only-through-index/)
  const parentIntoChildInterior = await gateOn((root) => {
    base(root, "export const invoicing = 1\n")
    write(root, "cubes/invoicing/issuance/leak.ts", 'export { series } from "./numbering/series.ts"\n')
  })
  assert.notEqual(parentIntoChildInterior.status, 0)
  assert.match(output(parentIntoChildInterior), /cube-tree-cubes-invoicing-issuance-to-cubes-invoicing-issuance-numbering-only-through-index/)
})

// The kernel port once reached into corrections and issuance for their document types;
// each child now owns its port, so those edges are refused like any other interior import.
const kernelPortFixture = (root, ports, support) => {
  makeUnit(root, "cubes/invoicing")
  write(root, "cubes/invoicing/application/ports.ts", ports)
  write(root, "cubes/invoicing/application/memory-store.test-support.ts", support)
  makeUnit(root, "cubes/invoicing/corrections", 'export type { Correction } from "./domain/corrections.ts"\n')
  write(root, "cubes/invoicing/corrections/domain/corrections.ts", "export interface Correction { readonly id: string }\n")
  makeUnit(root, "cubes/invoicing/issuance", 'export type { Proforma } from "./domain/proforma.ts"\n')
  write(root, "cubes/invoicing/issuance/domain/proforma.ts", "export interface Proforma { readonly id: string }\n")
}

test("refuses the kernel port and its test store reaching into a child's interior", async () => {
  const throughIndex = await gateOn((root) => kernelPortFixture(root,
    "export type Ports = string\n",
    'import type { Correction } from "../corrections/index.ts"\nimport type { Proforma } from "../issuance/index.ts"\nexport type Stored = Correction | Proforma\n'))
  assert.equal(throughIndex.status, 0, output(throughIndex))
  const portIntoCorrections = await gateOn((root) => kernelPortFixture(root,
    'import type { Correction } from "../corrections/domain/corrections.ts"\nexport type Ports = Correction\n',
    "export type Stored = string\n"))
  assert.notEqual(portIntoCorrections.status, 0)
  assert.match(output(portIntoCorrections), /cube-tree-cubes-invoicing-to-cubes-invoicing-corrections-only-through-index:/)
  const portIntoIssuance = await gateOn((root) => kernelPortFixture(root,
    'import type { Proforma } from "../issuance/domain/proforma.ts"\nexport type Ports = Proforma\n',
    "export type Stored = string\n"))
  assert.notEqual(portIntoIssuance.status, 0)
  assert.match(output(portIntoIssuance), /cube-tree-cubes-invoicing-to-cubes-invoicing-issuance-only-through-index:/)
  const storeIntoIssuance = await gateOn((root) => kernelPortFixture(root,
    "export type Ports = string\n",
    'import type { Proforma } from "../issuance/domain/proforma.ts"\nexport type Stored = Proforma\n'))
  assert.notEqual(storeIntoIssuance.status, 0)
  assert.match(output(storeIntoIssuance), /cube-tree-cubes-invoicing-to-cubes-invoicing-issuance-only-through-index:/)
})

test("still refuses import cycles inside one cube tree", async () => {
  const result = await gateOn((root) => {
    makeUnit(root, "cubes/invoicing", 'import { child } from "./reporting/index.ts"\nexport const parent = child\n')
    makeUnit(root, "cubes/invoicing/reporting", 'import { parent } from "../index.ts"\nexport const child = 1\nexport const read = () => parent\n')
  })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /no-circular-dependencies/)
})

test("refuses a required cube importing a plugin, and lets the plugin use its parent", async () => {
  const cube = (name, required, imports = "") =>
    `${imports}export const cube = { manifest: { name: "${name}", required: ${String(required)} } }\n`
  const base = (root, { parent = "", sibling = "", plugin = "" }) => {
    makeUnit(root, "cubes/invoicing", cube("invoicing", true, parent))
    makeUnit(root, "cubes/invoicing/catalog", cube("catalog", true, sibling))
    makeUnit(root, "cubes/invoicing/payments", cube("payments", false, plugin))
    write(root, "cubes/invoicing/shared.ts", "export const shared = 1\n")
  }
  const allowed = await gateOn((root) => base(root, { plugin: 'import "../shared.ts"\nimport "../catalog/index.ts"\n' }))
  assert.equal(allowed.status, 0, output(allowed))
  for (const imports of [{ parent: 'import "./payments/index.ts"\n' }, { sibling: 'import "../payments/index.ts"\n' }]) {
    const rejected = await gateOn((root) => base(root, imports))
    assert.notEqual(rejected.status, 0, JSON.stringify(imports))
    assert.match(output(rejected), /required-cube-does-not-import-plugin/)
  }
})
