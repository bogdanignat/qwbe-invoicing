import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  ensureParentDirectory,
  isArchivePath,
  type Manifest,
  runTar,
  safeDataPath,
  sha256File,
  sqliteFiles,
  sqliteFileSet,
} from "./backup-manifest.ts"

export interface BackupReport {
  readonly dataDirectory: string
  readonly output: string
  readonly scanned: number
  readonly copied: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
  readonly manifest: string
}

export const clearBrowserSessions = (path: string): void => {
  if (!existsSync(path)) return
  const database = new DatabaseSync(path)
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'browser_sessions'").get()
    if (table === undefined) return
    database.exec("PRAGMA secure_delete = ON")
    database.exec("DELETE FROM browser_sessions")
    database.exec("VACUUM")
  } finally {
    database.close()
  }
}

const snapshotSqlite = (source: string, target: string): void => {
  const database = new DatabaseSync(source, { readOnly: true })
  try { database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`) }
  finally { database.close() }
}

const collectDataFiles = (dataDirectory: string): ReadonlyArray<string> => {
  const files: Array<string> = []
  for (const name of sqliteFiles) {
    const full = join(dataDirectory, name)
    if (existsSync(full) && statSync(full).isFile()) files.push(full)
  }
  const artifactsRoot = join(dataDirectory, "artifacts")
  if (existsSync(artifactsRoot) && statSync(artifactsRoot).isDirectory()) {
    const walk = (directory: string): void => {
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

const stageBackup = (dataDirectory: string, staging: string): Manifest => {
  const files: Array<{ path: string; sha256: string; byteLength: number }> = []
  for (const full of collectDataFiles(dataDirectory)) {
    const rel = relative(dataDirectory, full)
    const target = safeDataPath(staging, rel)
    ensureParentDirectory(target)
    if (sqliteFileSet.has(rel)) snapshotSqlite(full, target)
    else copyFileSync(full, target)
    if (rel === "sessions.sqlite") clearBrowserSessions(target)
    files.push({ path: rel, sha256: sha256File(target), byteLength: statSync(target).size })
  }
  const manifest: Manifest = { createdAt: new Date().toISOString(), dataDirectory, files }
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export const planBackup = (dataDirectory: string): { readonly pending: ReadonlyArray<string> } => {
  if (!existsSync(dataDirectory) || !statSync(dataDirectory).isDirectory()) return { pending: [] }
  return { pending: collectDataFiles(dataDirectory).map((full) => relative(dataDirectory, full)) }
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
      runTar(["-czf", output, "-C", staging, "."])
      return { dataDirectory, output, scanned: files.length, copied: files.length, failed: 0, files,
        manifest: join(staging, "manifest.json") }
    }
    mkdirSync(output, { recursive: true })
    cpSync(staging, output, { recursive: true, force: true })
    return { dataDirectory, output, scanned: files.length, copied: files.length, failed: 0, files,
      manifest: join(output, "manifest.json") }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
