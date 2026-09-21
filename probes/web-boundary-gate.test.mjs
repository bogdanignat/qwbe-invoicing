import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

const gate = join(dirname(fileURLToPath(import.meta.url)), "boundary-gate.mjs")
const write = (root, path, content = "export type Value = string\n") => {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
const cruise = (build) => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-web-boundaries-"))
  try {
    // Keep a valid backend root: omitting web from the gate must fail these tests.
    write(root, "cube/invoicing/index.ts")
    write(root, "cube/invoicing/qwbe-package.json", "{}\n")
    build(root)
    const result = spawnSync(process.execPath, [gate, "--root", root], { encoding: "utf8" })
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const edge = (root, from, to, kind = "import") => {
  const relative = posix.relative(posix.dirname(from), to)
  const specifier = relative.startsWith(".") ? relative : `./${relative}`
  write(root, to)
  write(root, from, kind === "dynamic"
    ? `void import("${specifier}")\n`
    : `${kind} type { Value } from "${specifier}"\n`)
}
const rejects = (result, rule) => {
  assert.notEqual(result.status, 0, result.output)
  assert.ok(result.output.includes(rule), result.output)
}

const layers = ["lib", "hooks", "components", "views"]
for (const [sourceIndex, source] of layers.entries()) {
  for (const [targetIndex, target] of layers.entries()) {
    test(`${source} ${targetIndex <= sourceIndex ? "accepts" : "rejects"} ${target} dependencies`, () => {
      const result = cruise((root) => edge(root,
        `web/src/${source}/source.tsx`, `web/src/${target}/target.tsx`))
      if (targetIndex <= sourceIndex) assert.equal(result.status, 0, result.output)
      else rejects(result, `web-${source}-dependencies`)
    })
  }
  test(`${source} cannot import the composition root or an unclassified source directory`, () => {
    for (const target of ["App.tsx", "main.tsx", "misc/helper.ts"]) {
      rejects(cruise((root) => edge(root, `web/src/${source}/source.tsx`, `web/src/${target}`)),
        `web-${source}-dependencies`)
    }
  })
}

test("composition roots may import every frontend layer and styles", () => {
  const result = cruise((root) => {
    for (const layer of layers) write(root, `web/src/${layer}/entry.tsx`)
    write(root, "web/src/app.css", "body { margin: 0 }\n")
    write(root, "web/src/App.tsx", layers.map((layer) => `import "./${layer}/entry.tsx"`).join("\n"))
    write(root, "web/src/main.tsx", 'import "./App.tsx"\nimport "./app.css"\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("layer rules also reject type re-exports and dynamic imports", () => {
  for (const kind of ["export", "dynamic"]) {
    rejects(cruise((root) => edge(root, "web/src/lib/source.ts", "web/src/views/target.tsx", kind)),
      "web-lib-dependencies")
  }
})

test("frontend may not import backend or tooling, even from App", () => {
  for (const source of ["App.tsx", "lib/source.ts"]) {
    for (const target of ["cube/invoicing/index.ts", "standalone/http/runtime.ts", "probes/helper.mjs", "probes/fixtures/helper.ts", "bin/helper.ts"]) {
      rejects(cruise((root) => edge(root, `web/src/${source}`, target)), "web-does-not-import-backend-or-tooling")
    }
  }
})

test("only the exact App entry may use the exact shared UI routes file", () => {
  const routes = "standalone/http/ui-routes.ts"
  const allowed = cruise((root) => edge(root, "web/src/App.tsx", routes))
  assert.equal(allowed.status, 0, allowed.output)
  for (const source of ["main.tsx", "lib/routes.ts", "views/App.tsx", "App.tsx.extra.ts"]) {
    rejects(cruise((root) => edge(root, `web/src/${source}`, routes)), "web-ui-routes-only-from-app")
  }
  rejects(cruise((root) => edge(root, "web/src/App.tsx", `${routes}.extra.ts`)),
    "web-does-not-import-backend-or-tooling")
})

test("the shared UI routes file cannot smuggle dependencies into the browser", () => {
  for (const target of ["standalone/http/runtime.ts", "cube/invoicing/index.ts"]) {
    rejects(cruise((root) => {
      edge(root, "web/src/App.tsx", "standalone/http/ui-routes.ts")
      edge(root, "standalone/http/ui-routes.ts", target)
    }), "ui-routes-is-a-browser-leaf")
  }
})

const writePackage = (root) => {
  write(root, "node_modules/fixture-dependency/package.json",
    JSON.stringify({ name: "fixture-dependency", version: "1.0.0", type: "module", main: "index.js" }))
  write(root, "node_modules/fixture-dependency/index.js", 'import "./internal.js"\nexport const value = 1\n')
  write(root, "node_modules/fixture-dependency/internal.js", 'import "./index.js"\n')
}

test("UI routes cannot import a resolved third-party package", () => {
  rejects(cruise((root) => {
    writePackage(root)
    edge(root, "web/src/App.tsx", "standalone/http/ui-routes.ts")
    write(root, "standalone/http/ui-routes.ts", 'export { value } from "fixture-dependency"\n')
  }), "ui-routes-is-a-browser-leaf")
})

test("frontend layers may use packages without traversing their internals", () => {
  const result = cruise((root) => {
    writePackage(root)
    for (const layer of layers) {
      write(root, `web/src/${layer}/source.ts`, 'export { value } from "fixture-dependency"\n')
    }
  })
  assert.equal(result.status, 0, result.output)
})

test("frontend cycles are rejected, including in files unreachable from App", () => {
  rejects(cruise((root) => {
    write(root, "web/src/lib/first.ts", 'import "./second.ts"\n')
    write(root, "web/src/lib/second.ts", 'import "./first.ts"\n')
  }), "no-circular-dependencies")
})
