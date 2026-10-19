import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { runtimeConfig } from "../config.ts"
import { edgeConfig, publicHost, startEdgeServer } from "./edge-server.test-support.ts"
import { edgeRequest } from "./edge-transport.test-support.ts"
import { cacheControlFor, loadUiBundle, maximumBundleBytes, uiBundleFor } from "./ui-bundle.ts"
import { fakeIndex, writeFakeUiDist } from "./ui-dist.test-support.ts"

const scratch = (): string => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "qwbe-ui-test-"))

void test("QWBE_UI_DIR is read from the environment, and empty means unset", () => {
  assert.equal(runtimeConfig({ NODE_ENV: "test" }).uiDirectory, undefined)
  assert.equal(runtimeConfig({ NODE_ENV: "test", QWBE_UI_DIR: "" }).uiDirectory, undefined)
  assert.equal(runtimeConfig({ NODE_ENV: "test", QWBE_UI_DIR: "/app/frontend/dist" }).uiDirectory, "/app/frontend/dist")
})

void test("the manifest holds the build's regular files and nothing else", () => {
  const directory = writeFakeUiDist()
  try {
    const bundle = loadUiBundle(directory)
    assert.ok(bundle)
    assert.deepEqual([...bundle.files.keys()].sort(),
      ["/assets/index-B1x2c3d4.js", "/assets/index-Cc9_x-Yz.css", "/favicon.svg", "/index.html"])
    assert.equal(Buffer.from(bundle.index.body).toString("utf8"), fakeIndex)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** A fake build with `arrange` applied, and whether loading it throws `pattern`. */
const assertRefused = (what: string, arrange: (directory: string) => void, pattern: RegExp): void => {
  const directory = writeFakeUiDist()
  try {
    arrange(directory)
    assert.throws(() => loadUiBundle(directory), pattern, what)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

void test("a build name is its manifest key verbatim: the characters a browser sends literally", () => {
  const directory = writeFakeUiDist({ "assets/logo@2x-B1x2c3d4.png": "png", "icon+dark.svg": "svg", "assets/a~b_c.d-e.js": "js" })
  try {
    const keys = [...(loadUiBundle(directory)?.files.keys() ?? [])]
    for (const key of ["/assets/logo@2x-B1x2c3d4.png", "/icon+dark.svg", "/assets/a~b_c.d-e.js"]) assert.ok(keys.includes(key), key)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  for (const name of ["a b.js", "x%41.js", "ș.js", "a?b.js", "a#b.js", "a,b.js", "a=b.js", "a$b.js", "a&b.js", "a:b.js", "a'b.js"]) {
    assertRefused(name, (directory) => { writeFileSync(join(directory, "assets", name), "x") }, /QWBE_UI_DIR holds a name outside/u)
  }
  assertRefused("directory name", (directory) => { mkdirSync(join(directory, "assets", "sub dir")) }, /QWBE_UI_DIR holds a name outside/u)
})

void test("the size budget is checked before a file is read: a sparse file over it is refused unread", () => {
  assertRefused("one oversized file", (directory) => {
    const big = join(directory, "assets", "big-B1x2c3d4.bin")
    writeFileSync(big, "")
    truncateSync(big, maximumBundleBytes + 1)
  }, /QWBE_UI_DIR is larger than \d+ bytes \(at \/assets\/big-B1x2c3d4\.bin\)/u)
  // Two files that fit alone: the second is refused against what the first left.
  assertRefused("the budget is cumulative", (directory) => {
    for (const name of ["a.bin", "b.bin"]) {
      writeFileSync(join(directory, name), "")
      truncateSync(join(directory, name), maximumBundleBytes / 2 + 1)
    }
  }, /QWBE_UI_DIR is larger than \d+ bytes \(at \/[ab]\.bin\)/u)
})

void test("a non-regular file (a FIFO) in the build refuses to load, without being opened", () => {
  assertRefused("fifo", (directory) => { execFileSync("mkfifo", [join(directory, "assets", "pipe-B1x2c3d4.js")]) },
    /QWBE_UI_DIR may hold only regular files and directories: \/assets\/pipe-B1x2c3d4\.js/u)
})

void test("only hashed files under /assets/ are immutable; index.html is never cached", () => {
  const immutable = "public, max-age=31536000, immutable"
  assert.equal(cacheControlFor("/index.html"), "no-store")
  for (const path of ["/assets/index-B1x2c3d4.js", "/assets/vendor-react-Cc9_x-Yz.css", "/assets/logo-AbCdEf12.svg"]) {
    assert.equal(cacheControlFor(path), immutable, path)
  }
  for (const path of ["/favicon.svg", "/assets/app.js", "/assets/index-B1x2.js", "/robots-B1x2c3d4.txt"]) {
    assert.equal(cacheControlFor(path), "no-cache", path)
  }
})

void test("no build to serve: a missing directory or one without index.html", () => {
  const directory = scratch()
  try {
    assert.equal(loadUiBundle(join(directory, "absent")), undefined)
    mkdirSync(join(directory, "assets"))
    writeFileSync(join(directory, "assets", "index-B1x2c3d4.js"), "x")
    assert.equal(loadUiBundle(directory), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("a symlink anywhere in the build, or the build being one, refuses to load", () => {
  const outside = scratch()
  writeFileSync(join(outside, "secret.txt"), "outside the build")
  const cases: ReadonlyArray<readonly [string, (directory: string) => string]> = [
    ["file symlink", (directory) => { symlinkSync(join(outside, "secret.txt"), join(directory, "assets", "leak-B1x2c3d4.js")); return directory }],
    ["directory symlink", (directory) => { symlinkSync(outside, join(directory, "linked")); return directory }],
    ["index symlink", (directory) => {
      rmSync(join(directory, "index.html"))
      symlinkSync(join(outside, "secret.txt"), join(directory, "index.html"))
      return directory
    }],
    ["root symlink", (directory) => { const link = join(outside, "dist-link"); symlinkSync(directory, link); return link }],
  ]
  try {
    for (const [what, arrange] of cases) {
      const directory = writeFakeUiDist()
      try {
        assert.throws(() => loadUiBundle(arrange(directory)), /QWBE_UI_DIR/u, what)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

void test("production refuses to serve without a build; development and tests run without one", async () => {
  const empty = scratch()
  try {
    const production = { nodeEnvironment: "production" } as const
    assert.throws(() => uiBundleFor(edgeConfig({ ...production, uiDirectory: undefined })), /QWBE_UI_DIR is required to serve in production/u)
    assert.throws(() => uiBundleFor(edgeConfig({ ...production, uiDirectory: empty })), /QWBE_UI_DIR has no index\.html/u)
    assert.throws(() => uiBundleFor(edgeConfig({ ...production, uiDirectory: join(empty, "absent") })), /QWBE_UI_DIR has no index\.html/u)
    let created = 0
    await assert.rejects(startEdgeServer({ config: { ...production, uiDirectory: empty },
      dependencies: { apiHandlerFactory: () => { created += 1; throw new Error("must not be created") } } }),
    /QWBE_UI_DIR has no index\.html/u)
    assert.equal(created, 0, "nothing is created and nothing listens")

    for (const nodeEnvironment of ["development", "test"]) {
      for (const uiDirectory of [undefined, empty]) {
        assert.equal(uiBundleFor(edgeConfig({ nodeEnvironment, uiDirectory })), undefined)
      }
      const server = await startEdgeServer({ config: { nodeEnvironment, uiDirectory: empty } })
      try {
        const page = await edgeRequest(server.port, { path: "/invoices/abc", headers: { host: publicHost } })
        assert.equal(page.status, 503, nodeEnvironment)
        assert.deepEqual(JSON.parse(page.body), { error: "ui_not_built" })
        assert.equal(page.headers["cache-control"], "no-store")
        assert.equal((await edgeRequest(server.port, { path: "/health/live", headers: { host: publicHost } })).status, 200)
      } finally {
        await server.close()
      }
    }
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

void test("production serves the build it was given", async () => {
  const directory = writeFakeUiDist()
  const server = await startEdgeServer({ config: { nodeEnvironment: "production", uiDirectory: directory } })
  try {
    const page = await edgeRequest(server.port, { path: "/settings/integrations", headers: { host: publicHost } })
    assert.equal(page.status, 200)
    assert.equal(page.body, fakeIndex)
  } finally {
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
