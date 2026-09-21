import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path"

export interface Manifest {
  readonly createdAt: string
  readonly dataDirectory: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly byteLength: number }>
}

export const sqliteFiles = ["invoicing.sqlite", "documents.sqlite", "sessions.sqlite"] as const
export const sqliteFileSet: ReadonlySet<string> = new Set(sqliteFiles)

export const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

export const safeDataPath = (root: string, path: string): string => {
  const normalized = normalize(path)
  const allowed = sqliteFileSet.has(normalized) || normalized.startsWith(`artifacts${sep}`)
  if (path.length === 0 || path.includes("\0") || path.includes("\\") || isAbsolute(path)
    || normalized !== path || normalized === ".." || normalized.startsWith(`..${sep}`) || !allowed) {
    throw new Error(`backup path is not allowed: ${path}`)
  }
  const target = resolve(root, normalized)
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error(`backup path escapes root: ${path}`)
  return target
}

export const ensureParentDirectory = (target: string): void => {
  mkdirSync(dirname(target), { recursive: true })
}

export const isArchivePath = (path: string): boolean => path.endsWith(".tar.gz") || path.endsWith(".tgz")

export const runTar = (args: ReadonlyArray<string>): void => {
  const result = spawnSync("tar", [...args], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`tar failed: ${result.stderr || result.stdout || `exit ${String(result.status)}`}`)
  }
}

export const verifyManifest = (staging: string): Manifest => {
  const manifestPath = join(staging, "manifest.json")
  if (!existsSync(manifestPath)) throw new Error("backup manifest.json missing")
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest
  const seen = new Set<string>()
  for (const entry of parsed.files) {
    if (seen.has(entry.path)) throw new Error(`duplicate backup path: ${entry.path}`)
    seen.add(entry.path)
    const filePath = safeDataPath(staging, entry.path)
    if (!existsSync(filePath)) throw new Error(`backup file missing in archive: ${entry.path}`)
    const actual = sha256File(filePath)
    if (actual !== entry.sha256) throw new Error(`backup integrity mismatch for ${entry.path}`)
  }
  return parsed
}

export const collectStagedFiles = (manifest: Manifest): ReadonlyArray<string> =>
  manifest.files.map((entry) => entry.path)
