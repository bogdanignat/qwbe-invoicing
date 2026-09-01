import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import { DatabaseSync } from "node:sqlite"

export interface BackupReport {
  readonly dataDirectory: string
  readonly output: string
  readonly scanned: number
  readonly copied: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
  readonly manifest: string
}

export interface RestoreReport {
  readonly dataDirectory: string
  readonly input: string
  readonly scanned: number
  readonly restored: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
}

interface Manifest {
  readonly createdAt: string
  readonly dataDirectory: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly byteLength: number }>
}

const sqliteFiles = ["invoicing.sqlite", "documents.sqlite", "sessions.sqlite"] as const
const sqliteFileSet: ReadonlySet<string> = new Set(sqliteFiles)

const sha256File = (path: string): string => {
  const bytes = readFileSync(path)
  return createHash("sha256").update(bytes).digest("hex")
}

const clearBrowserSessions = (path: string): void => {
  if (!existsSync(path)) return
  const database = new DatabaseSync(path)
  try {
    const table = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'browser_sessions'",
    ).get()
    if (table === undefined) return
    database.exec("PRAGMA secure_delete = ON")
    database.exec("DELETE FROM browser_sessions")
    database.exec("VACUUM")
  } finally {
    database.close()
  }
}

const safeDataPath = (root: string, path: string): string => {
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

const snapshotSqlite = (source: string, target: string): void => {
  const database = new DatabaseSync(source, { readOnly: true })
  try {
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    database.close()
  }
}

const collectDataFiles = (dataDirectory: string): ReadonlyArray<string> => {
  const files: Array<string> = []
  for (const name of sqliteFiles) {
    const full = join(dataDirectory, name)
    if (existsSync(full) && statSync(full).isFile()) files.push(full)
  }
  const artifactsRoot = join(dataDirectory, "artifacts")
  if (existsSync(artifactsRoot) && statSync(artifactsRoot).isDirectory()) {
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) files.push(full)
      }
    }
    walk(artifactsRoot)
  }
  return files
}

const relativeFiles = (dataDirectory: string, absolute: ReadonlyArray<string>): ReadonlyArray<string> =>
  absolute.map((full) => relative(dataDirectory, full))

const ensureParentDirectory = (target: string) => {
  mkdirSync(dirname(target), { recursive: true })
}

const isArchivePath = (path: string): boolean => path.endsWith(".tar.gz") || path.endsWith(".tgz")

const stageBackup = (dataDirectory: string, staging: string): Manifest => {
  const absolute = collectDataFiles(dataDirectory)
  const files: Array<{ path: string; sha256: string; byteLength: number }> = []
  for (const full of absolute) {
    const rel = relative(dataDirectory, full)
    const target = safeDataPath(staging, rel)
    ensureParentDirectory(target)
    if (sqliteFileSet.has(rel)) snapshotSqlite(full, target)
    else copyFileSync(full, target)
    if (rel === "sessions.sqlite") clearBrowserSessions(target)
    const stat = statSync(target)
    files.push({ path: rel, sha256: sha256File(target), byteLength: stat.size })
  }
  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    dataDirectory,
    files,
  }
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const runTar = (args: ReadonlyArray<string>): void => {
  const result = spawnSync("tar", [...args], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`tar failed: ${result.stderr || result.stdout || `exit ${String(result.status)}`}`)
  }
}

export const planBackup = (dataDirectory: string): { readonly pending: ReadonlyArray<string> } => {
  if (!existsSync(dataDirectory) || !statSync(dataDirectory).isDirectory()) {
    return { pending: [] }
  }
  const absolute = collectDataFiles(dataDirectory)
  return { pending: relativeFiles(dataDirectory, absolute) }
}

export const executeBackup = (dataDirectory: string, output: string): BackupReport => {
  if (!existsSync(dataDirectory) || !statSync(dataDirectory).isDirectory()) {
    throw new Error(`data directory does not exist: ${dataDirectory}`)
  }
  const staging = mkdtempSync(join(tmpdir(), "qwbe-backup-"))
  try {
    const manifest = stageBackup(dataDirectory, staging)
    const files = manifest.files.map((entry) => entry.path)
    if (isArchivePath(output)) {
      ensureParentDirectory(output)
      // Include manifest.json explicitly via tar of staging contents
      runTar(["-czf", output, "-C", staging, "."])
      return {
        dataDirectory,
        output,
        scanned: files.length,
        copied: files.length,
        failed: 0,
        files,
        manifest: join(staging, "manifest.json"),
      }
    }
    // Directory output: copy staging recursively
    mkdirSync(output, { recursive: true })
    cpSync(staging, output, { recursive: true, force: true })
    return {
      dataDirectory,
      output,
      scanned: files.length,
      copied: files.length,
      failed: 0,
      files,
      manifest: join(output, "manifest.json"),
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const verifyManifest = (staging: string): Manifest => {
  const manifestPath = join(staging, "manifest.json")
  if (!existsSync(manifestPath)) throw new Error("backup manifest.json missing")
  const raw = readFileSync(manifestPath, "utf8")
  const parsed = JSON.parse(raw) as Manifest
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

const collectStagedFiles = (manifest: Manifest): ReadonlyArray<string> =>
  manifest.files.map((entry) => entry.path)

export const planRestore = (_dataDirectory: string, input: string): { readonly pending: ReadonlyArray<string> } => {
  if (!existsSync(input)) return { pending: [] }
  const staging = mkdtempSync(join(tmpdir(), "qwbe-restore-plan-"))
  try {
    if (isArchivePath(input)) {
      runTar(["-xzf", input, "-C", staging])
    } else {
      cpSync(input, staging, { recursive: true, force: true })
    }
    const manifest = verifyManifest(staging)
    return { pending: collectStagedFiles(manifest) }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export const executeRestore = (dataDirectory: string, input: string): RestoreReport => {
  if (!existsSync(input)) throw new Error(`backup input does not exist: ${input}`)
  const staging = mkdtempSync(join(tmpdir(), "qwbe-restore-"))
  try {
    if (isArchivePath(input)) {
      runTar(["-xzf", input, "-C", staging])
    } else {
      if (!statSync(input).isDirectory()) throw new Error(`backup input must be a directory or .tar.gz: ${input}`)
      cpSync(input, staging, { recursive: true, force: true })
    }
    const manifest = verifyManifest(staging)
    const files = collectStagedFiles(manifest)
    mkdirSync(dataDirectory, { recursive: true })
    let restored = 0
    for (const rel of files) {
      const source = safeDataPath(staging, rel)
      const target = safeDataPath(dataDirectory, rel)
      ensureParentDirectory(target)
      // Atomic copy via temp + rename when possible
      const tempTarget = `${target}.${String(Date.now())}.tmp`
      copyFileSync(source, tempTarget)
      // Verify before move
      const actual = sha256File(tempTarget)
      const expected = manifest.files.find((entry) => entry.path === rel)?.sha256
      if (expected !== undefined && actual !== expected) {
        rmSync(tempTarget, { force: true })
        throw new Error(`restore integrity mismatch for ${rel}`)
      }
      // Overwrite atomically
      try {
        // Use rename if same filesystem, fallback to copy
        const renamed = (() => {
          try {
            // Ensure target not locked by SQLite WAL: remove temp then rename
            if (existsSync(target)) rmSync(target, { force: true })
            copyFileSync(tempTarget, target)
            rmSync(tempTarget, { force: true })
            return true
          } catch {
            return false
          }
        })()
        if (!renamed) throw new Error(`failed to restore ${rel}`)
      } finally {
        rmSync(tempTarget, { force: true })
      }
      // Copy basename for logging clarity
      void basename(target)
      restored += 1
    }
    clearBrowserSessions(join(dataDirectory, "sessions.sqlite"))
    // Preserve manifest copy next to data for audit (optional)
    return {
      dataDirectory,
      input,
      scanned: files.length,
      restored,
      failed: 0,
      files,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
