import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { listCube } from "./cube-fixture.test-support.mjs"

const gate = join(dirname(fileURLToPath(import.meta.url)), "boundary-gate.mjs")
const write = (root, path, content = "export type Value = string\n") => {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
const fakePackage = (root, name) => {
  const directory = `node_modules/${name}`
  write(root, `${directory}/package.json`, JSON.stringify({
    name, version: "1.0.0", type: "module", main: "index.js", exports: { ".": "./index.js", "./*": "./index.js" },
  }))
  write(root, `${directory}/index.js`, "export const value = 1\n")
}
const cruise = (build) => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-frontend-boundaries-"))
  try {
    // A valid backend root makes every frontend-only rejection prove frontend/src was cruised.
    write(root, "cubes/invoicing/index.ts")
    listCube(root, "cubes/invoicing")
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
  const statement = kind === "dynamic"
    ? `void import("${specifier}")\n`
    : kind === "export"
      ? `export type { Value } from "${specifier}"\n`
      : `import type { Value } from "${specifier}"\nexport type Alias = Value\n`
  write(root, from, statement)
}
const rejects = (result, rule) => {
  assert.notEqual(result.status, 0, result.output)
  assert.ok(result.output.includes(rule), result.output)
}

const layers = ["lib", "hooks", "components", "views", "routes"]
test("frontend layer matrix only points downward", () => {
  for (const [sourceIndex, source] of layers.entries()) {
    for (const [targetIndex, target] of layers.entries()) {
      const result = cruise((root) => edge(root,
        `frontend/src/${source}/source.ts`, `frontend/src/${target}/target.ts`))
      if (targetIndex <= sourceIndex) assert.equal(result.status, 0, result.output)
      else rejects(result, `frontend-${source}-dependencies`)
    }
  }
})

test("no layer imports the entrypoint, the route tree, or unclassified frontend sources", () => {
  for (const source of layers) {
    for (const target of ["main.tsx", "routeTree.gen.ts", "misc/helper.ts"]) {
      rejects(cruise((root) => edge(root, `frontend/src/${source}/source.ts`, `frontend/src/${target}`)),
        `frontend-${source}-dependencies`)
    }
  }
})

test("the entrypoint and the route tree compose every frontend layer", () => {
  const result = cruise((root) => {
    for (const layer of layers) write(root, `frontend/src/${layer}/entry.ts`)
    write(root, "frontend/src/routeTree.gen.ts", layers.map((layer) => `import "./${layer}/entry.ts"`).join("\n"))
    write(root, "frontend/src/main.tsx", 'import "./routeTree.gen.ts"\nimport "./lib/entry.ts"\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("layer rules cover type re-exports and dynamic imports", () => {
  for (const kind of ["export", "dynamic"]) {
    rejects(cruise((root) => edge(root, "frontend/src/lib/source.ts", "frontend/src/views/target.ts", kind)),
      "frontend-lib-dependencies")
  }
})

test("frontend cannot import backend, tooling, or the Vite build output", () => {
  for (const target of [
    "cubes/invoicing/index.ts", "kernel/http/runtime.ts", "probes/helper.mjs", "bin/helper.ts",
    "frontend/dist/assets/index-a1b2c3d4.js",
  ]) {
    rejects(cruise((root) => edge(root, "frontend/src/routes/index.tsx", target)),
      target.startsWith("frontend/dist/") ? "frontend-does-not-import-build-output" : "frontend-does-not-import-host-or-tooling")
  }
})

test("backend cannot import frontend", () => {
  for (const source of ["cubes/invoicing/leak.ts", "kernel/leak.ts"]) {
    rejects(cruise((root) => edge(root, source, "frontend/src/lib/value.ts")), "backend-does-not-import-frontend")
  }
})

test("frontend cannot bypass source boundaries through runtime or operational scripts", () => {
  for (const source of ["frontend/src/lib/client.ts", "frontend/src/routes/index.tsx", "frontend/src/main.tsx"]) {
    for (const target of ["frontend/scripts/route-tree.ts", "scripts/efactura-fixtures.mjs"]) {
      for (const kind of ["import", "export", "dynamic"]) {
        rejects(cruise((root) => {
          edge(root, source, target, kind)
          const downstream = target.startsWith("frontend/")
            ? "frontend/src/lib/value.ts" : "kernel/runtime.ts"
          write(root, downstream)
          write(root, target, `import "${posix.relative(posix.dirname(target), downstream)}"\nexport const value = 1\n`)
        }), "frontend-does-not-import-host-or-tooling")
      }
    }
  }
})

const browserSources = [
  "lib/browser.ts", "hooks/browser.ts", "components/browser.ts", "views/browser.ts",
  "routes/index.tsx", "routes/invoices/$id.tsx", "main.tsx", "routeTree.gen.ts",
]

test("browser code cannot import the Vite config or its build-time packages, directly or through a bridge", () => {
  for (const kind of ["import", "export", "dynamic"]) {
    for (const source of ["frontend/src/hooks/source.ts", "frontend/src/routes/index.tsx", "frontend/src/main.tsx"]) {
      rejects(cruise((root) => edge(root, source, "frontend/vite.config.ts", kind)), "frontend-browser-does-not-import-server")
    }
  }
  rejects(cruise((root) => {
    edge(root, "frontend/src/components/source.ts", "frontend/src/lib/config-bridge.ts")
    edge(root, "frontend/src/lib/config-bridge.ts", "frontend/vite.config.ts", "export")
  }), "frontend-browser-does-not-import-server")
  for (const dependency of ["vite", "@vitejs/plugin-react", "@tailwindcss/vite", "@tanstack/router-plugin"]) {
    rejects(cruise((root) => {
      fakePackage(root, dependency)
      write(root, "frontend/src/routes/index.tsx", `import "${dependency}"\n`)
    }), "frontend-browser-does-not-import-server")
  }
})

test("no browser module imports Node builtins, routes and entrypoint included", () => {
  for (const source of browserSources) {
    rejects(cruise((root) => write(root, `frontend/src/${source}`, 'import "node:fs"\n')),
      "frontend-browser-does-not-import-node")
  }
})

test("Node-based frontend tests may exercise a pure browser helper", () => {
  const result = cruise((root) => {
    write(root, "frontend/src/lib/search-params.ts", "export const parse = () => ({})\n")
    write(root, "frontend/src/lib/search-params.test.ts",
      'import assert from "node:assert/strict"\nimport { parse } from "./search-params.ts"\nassert.ok(parse())\n')
    write(root, "frontend/src/main.tsx", 'import { parse } from "./lib/search-params.ts"\nvoid parse\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("unresolved frontend dependencies fail without path alias exceptions", () => {
  for (const source of ['import "missing-package"\n', 'import "@/lib/value.ts"\n']) {
    rejects(cruise((root) => write(root, "frontend/src/lib/source.ts", source)), "frontend-no-unresolved")
  }
})

test("resolved React and TanStack runtime package imports are accepted", () => {
  const result = cruise((root) => {
    for (const dependency of ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-router"]) fakePackage(root, dependency)
    write(root, "frontend/src/main.tsx", 'import "react-dom/client"\nimport "@tanstack/react-router"\n')
    write(root, "frontend/src/routes/index.tsx", 'import "@tanstack/react-router"\nimport "react"\n')
    write(root, "frontend/src/hooks/query.ts", 'import "@tanstack/react-query"\nimport "@tanstack/react-router"\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("frontend cycles are rejected even when orphaned from app", () => {
  rejects(cruise((root) => {
    write(root, "frontend/src/lib/first.ts", 'import "./second.ts"\n')
    write(root, "frontend/src/lib/second.ts", 'import "./first.ts"\n')
  }), "no-circular-dependencies")
})
