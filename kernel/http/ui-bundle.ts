import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"

import type { RuntimeConfig } from "../config.ts"

/**
 * The Vite build (`QWBE_UI_DIR`), read once when a server starts and kept in
 * memory. A request only ever looks a path up in this map: it never builds a
 * path on disk, so no request can reach a file the build did not ship.
 */
export interface UiFile {
  readonly body: Uint8Array
  readonly contentType: string
  readonly cacheControl: string
}

export interface UiBundle {
  readonly index: UiFile
  /** Keyed by the URL path the file answers on (`/assets/index-B1x2c3d4.js`). */
  readonly files: ReadonlyMap<string, UiFile>
}

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
}

/** Vite names what it emits under `assets/` `[name]-[hash].[ext]`, the hash eight base64url characters. */
const hashedAsset = /^\/assets\/(?:[^/]+\/)*[^/]+-[\w-]{8}\.[a-z0-9]+$/iu
const immutable = "public, max-age=31536000, immutable"

export const cacheControlFor = (urlPath: string): string => {
  if (urlPath === "/index.html") return "no-store"
  return hashedAsset.test(urlPath) ? immutable : "no-cache"
}

/** A misconfigured `QWBE_UI_DIR` (`/`, a home directory) refuses instead of filling the heap. */
export const maximumBundleBytes = 64 * 1024 * 1024

interface Walk {
  readonly files: Map<string, UiFile>
  bytes: number
}

/**
 * The file's size is checked against what is left of the budget BEFORE it is
 * read, so an oversized (or sparse) file is refused without being loaded.
 */
const readRegularFile = (path: string, urlPath: string, budget: number): Uint8Array => {
  // O_NOFOLLOW: a file swapped for a symlink after the directory was listed is refused, not followed.
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`QWBE_UI_DIR holds a non-regular file: ${urlPath}`)
    if (stat.size > budget) throw new Error(`QWBE_UI_DIR is larger than ${String(maximumBundleBytes)} bytes (at ${urlPath})`)
    const body = readFileSync(descriptor)
    if (body.length !== stat.size) throw new Error(`QWBE_UI_DIR changed while it was read: ${urlPath}`)
    return body
  } finally {
    closeSync(descriptor)
  }
}

/**
 * The characters a build file or directory may be named with. The browser sends
 * them literally and the edge (`edge-target.ts`) lets them through unescaped, so
 * the manifest key is the name itself and a lookup is an exact string match.
 * Anything else (a space, `%`, `?`, `#`, non-ASCII) refuses to start instead of
 * becoming a file that can never be requested.
 */
const servableName = /^[A-Za-z0-9._~@+-]+$/u

/**
 * Regular files and directories only: a symlink, a socket or a device anywhere
 * in the build refuses to start, because the bundle must be exactly what is in
 * the directory and nothing it points at. Dot entries (`.vite/`) are not shipped.
 */
const walk = (state: Walk, directory: string, urlPrefix: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const urlPath = `${urlPrefix}/${entry.name}`
    if (!servableName.test(entry.name)) throw new Error(`QWBE_UI_DIR holds a name outside [A-Za-z0-9._~@+-]: ${JSON.stringify(urlPath)}`)
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { walk(state, path, urlPath); continue }
    if (!entry.isFile()) throw new Error(`QWBE_UI_DIR may hold only regular files and directories: ${urlPath}`)
    const body = readRegularFile(path, urlPath, maximumBundleBytes - state.bytes)
    state.bytes += body.length
    const contentType = contentTypes[extname(entry.name).toLowerCase()] ?? "application/octet-stream"
    state.files.set(urlPath, { body, contentType, cacheControl: cacheControlFor(urlPath) })
  }
}

/**
 * The bundle in `directory`, or `undefined` when there is none to serve: the
 * directory does not exist, or it has no `index.html`. A directory that exists
 * but is not what a build produces (a symlink, a special file, too large)
 * throws in every environment.
 */
export const loadUiBundle = (directory: string): UiBundle | undefined => {
  const root = resolve(directory)
  let rootStat
  try {
    rootStat = lstatSync(root)
  } catch {
    return undefined
  }
  if (!rootStat.isDirectory()) throw new Error(`QWBE_UI_DIR must be a directory, not a file or a symlink: ${root}`)
  const state: Walk = { files: new Map(), bytes: 0 }
  walk(state, root, "")
  const index = state.files.get("/index.html")
  return index === undefined ? undefined : { index, files: state.files }
}

/**
 * The UI a server starts with. In production a missing build refuses to serve,
 * before anything listens; elsewhere the kernel runs without a UI and its UI
 * routes answer 503 `ui_not_built` (development against `vite dev`, and every
 * kernel test that does not care about the UI).
 */
export const uiBundleFor = (config: RuntimeConfig): UiBundle | undefined => {
  const bundle = config.uiDirectory === undefined ? undefined : loadUiBundle(config.uiDirectory)
  if (bundle !== undefined || config.nodeEnvironment !== "production") return bundle
  if (config.uiDirectory === undefined) throw new Error("QWBE_UI_DIR is required to serve in production")
  throw new Error(`QWBE_UI_DIR has no index.html (run the Vite build): ${resolve(config.uiDirectory)}`)
}
