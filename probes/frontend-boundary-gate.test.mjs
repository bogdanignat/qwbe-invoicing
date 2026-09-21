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

const layers = ["lib", "hooks", "components", "views"]
test("frontend layer matrix matches the legacy web direction", () => {
  for (const [sourceIndex, source] of layers.entries()) {
    for (const [targetIndex, target] of layers.entries()) {
      const result = cruise((root) => edge(root,
        `frontend/src/${source}/source.ts`, `frontend/src/${target}/target.ts`))
      if (targetIndex <= sourceIndex) assert.equal(result.status, 0, result.output)
      else rejects(result, `frontend-${source}-dependencies`)
    }
  }
})

test("lower layers cannot import app, proxy, or unclassified frontend sources", () => {
  for (const source of layers) {
    for (const target of ["app/page.tsx", "proxy.ts", "misc/helper.ts"]) {
      rejects(cruise((root) => edge(root, `frontend/src/${source}/source.ts`, `frontend/src/${target}`)),
        `frontend-${source}-dependencies`)
    }
  }
})

test("app and proxy composition may import every frontend layer", () => {
  const result = cruise((root) => {
    for (const layer of layers) write(root, `frontend/src/${layer}/entry.ts`)
    write(root, "frontend/src/app/page.tsx", layers.map((layer) => `import "../${layer}/entry.ts"`).join("\n"))
    write(root, "frontend/src/proxy.ts", 'import "./lib/entry.ts"\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("layer rules cover type re-exports and dynamic imports", () => {
  for (const kind of ["export", "dynamic"]) {
    rejects(cruise((root) => edge(root, "frontend/src/lib/source.ts", "frontend/src/views/target.ts", kind)),
      "frontend-lib-dependencies")
  }
})

test("frontend cannot import backend, legacy web, tooling, or Next build output", () => {
  for (const target of [
    "cube/invoicing/index.ts", "standalone/http/runtime.ts", "web/src/lib/client.ts", "probes/helper.mjs", "bin/helper.ts",
    "frontend/.next/server/generated.js",
  ]) {
    rejects(cruise((root) => edge(root, "frontend/src/app/page.tsx", target)),
      target.startsWith("frontend/.next/") ? "frontend-does-not-import-build-output" : "frontend-does-not-import-host-or-tooling")
  }
})

test("backend and legacy web cannot import frontend", () => {
  for (const source of ["cube/invoicing/leak.ts", "standalone/leak.ts", "web/src/lib/leak.ts"]) {
    rejects(cruise((root) => edge(root, source, "frontend/src/lib/value.ts")),
      source.startsWith("web/") ? "web-does-not-import-frontend" : "backend-does-not-import-frontend")
  }
})

test("frontend cannot bypass source boundaries through runtime or operational scripts", () => {
  for (const source of ["frontend/src/lib/client.ts", "frontend/src/app/api/qwbe/route.ts"]) {
    for (const target of ["frontend/scripts/validate-runtime.mjs", "scripts/efactura-fixtures.mjs"]) {
      for (const kind of ["import", "export", "dynamic"]) {
        rejects(cruise((root) => {
          edge(root, source, target, kind)
          const downstream = target.startsWith("frontend/")
            ? "frontend/src/lib/server/config.ts" : "standalone/runtime.ts"
          write(root, downstream)
          write(root, target, `import "${posix.relative(posix.dirname(target), downstream)}"\nexport const value = 1\n`)
        }), "frontend-does-not-import-host-or-tooling")
      }
    }
  }
})

test("browser modules cannot import server modules directly, by re-export, or dynamically", () => {
  for (const kind of ["import", "export", "dynamic"]) {
    rejects(cruise((root) => edge(root, "frontend/src/hooks/source.ts", "frontend/src/lib/server/private.ts", kind)),
      "frontend-browser-does-not-import-server")
  }
  rejects(cruise((root) => {
    edge(root, "frontend/src/components/source.ts", "frontend/src/lib/server-bridge.ts")
    edge(root, "frontend/src/lib/server-bridge.ts", "frontend/src/lib/server/private.ts", "export")
  }), "frontend-browser-does-not-import-server")
})

test("browser modules cannot import Node builtins, while server modules can", () => {
  for (const source of ["lib/browser.ts", "hooks/browser.ts", "components/browser.ts", "views/browser.ts"]) {
    rejects(cruise((root) => write(root, `frontend/src/${source}`, 'import "node:fs"\n')),
      "frontend-browser-does-not-import-node")
  }
  const allowed = cruise((root) => write(root, "frontend/src/lib/server/runtime.ts", 'import "node:fs"\n'))
  assert.equal(allowed.status, 0, allowed.output)
})

test("Node-based frontend tests may exercise a pure browser security helper", () => {
  const result = cruise((root) => {
    write(root, "frontend/src/lib/security-headers.ts", "export const headers = {}\n")
    write(root, "frontend/src/lib/security-headers.test.ts",
      'import assert from "node:assert/strict"\nimport { headers } from "./security-headers.ts"\nassert.ok(headers)\n')
    write(root, "frontend/src/proxy.ts", 'import { headers } from "./lib/security-headers.ts"\nvoid headers\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("non-route app modules cannot import server modules but route modules can", () => {
  for (const module of [
    "frontend/src/app/page.ts",
    "frontend/src/app/invoices/page.tsx",
    "frontend/src/app/layout.tsx",
    "frontend/src/app/error.tsx",
    "frontend/src/app/global-error.tsx",
  ]) {
    rejects(cruise((root) => {
      edge(root, module, "frontend/src/lib/server/private.ts")
      if (module.endsWith("error.tsx")) {
        const target = posix.relative(posix.dirname(module), "frontend/src/lib/server/private.ts")
        write(root, module, `"use client"\nimport type { Value } from "${target.startsWith(".") ? target : `./${target}`}"\nexport type Alias = Value\n`)
      }
    }), "frontend-app-does-not-import-server")
  }
  const result = cruise((root) => edge(root,
    "frontend/src/app/api/qwbe/route.ts", "frontend/src/lib/server/private.ts"))
  assert.equal(result.status, 0, result.output)
})

test("unresolved frontend dependencies fail without path alias exceptions", () => {
  for (const source of ['import "missing-package"\n', 'import "@/lib/value.ts"\n']) {
    rejects(cruise((root) => write(root, "frontend/src/lib/source.ts", source)), "frontend-no-unresolved")
  }
})

test("resolved Next, React, TanStack, and server-only package imports are accepted", () => {
  const result = cruise((root) => {
    for (const dependency of ["next", "react", "@tanstack/react-query", "server-only"]) fakePackage(root, dependency)
    write(root, "frontend/src/app/page.tsx", 'import "next/navigation"\nimport "react"\n')
    write(root, "frontend/src/hooks/query.ts", 'import "@tanstack/react-query"\n')
    write(root, "frontend/src/app/api/qwbe/route.ts", 'import "server-only"\nimport "next/server"\n')
  })
  assert.equal(result.status, 0, result.output)
})

test("frontend cycles are rejected even when orphaned from app", () => {
  rejects(cruise((root) => {
    write(root, "frontend/src/lib/first.ts", 'import "./second.ts"\n')
    write(root, "frontend/src/lib/second.ts", 'import "./first.ts"\n')
  }), "no-circular-dependencies")
})
