import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { clearBrowserSessions } from "./backup-create.ts"
import {
  collectStagedFiles,
  ensureParentDirectory,
  isArchivePath,
  runTar,
  safeDataPath,
  sha256File,
  sqliteFileSet,
  verifyManifest,
} from "./backup-manifest.ts"

export interface RestoreReport {
  readonly dataDirectory: string
  readonly input: string
  readonly scanned: number
  readonly restored: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
}

const stageInput = (input: string, staging: string): void => {
  if (isArchivePath(input)) runTar(["-xzf", input, "-C", staging])
  else cpSync(input, staging, { recursive: true, force: true })
}

export const planRestore = (_dataDirectory: string, input: string): { readonly pending: ReadonlyArray<string> } => {
  if (!existsSync(input)) return { pending: [] }
  const staging = mkdtempSync(join(tmpdir(), "qwbe-restore-plan-"))
  try {
    stageInput(input, staging)
    return { pending: collectStagedFiles(verifyManifest(staging)) }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const sqliteSidecars = ["-wal", "-shm", "-journal"] as const

const assertNotInUse = (target: string): void => {
  if (!existsSync(target)) return
  const database = new DatabaseSync(target)
  try {
    database.exec("BEGIN IMMEDIATE")
    database.exec("ROLLBACK")
  } catch {
    throw new Error(`database is in use, stop the application before restoring: ${basename(target)}`)
  } finally {
    database.close()
  }
}

const replaceFile = (source: string, target: string, expectedSha256: string | undefined): void => {
  const staged = `${target}.restore-${String(process.pid)}.tmp`
  try {
    copyFileSync(source, staged)
    const actual = sha256File(staged)
    if (expectedSha256 !== undefined && actual !== expectedSha256) {
      throw new Error(`restore integrity mismatch for ${basename(target)}`)
    }
    renameSync(staged, target)
  } finally {
    rmSync(staged, { force: true })
  }
}

export const executeRestore = (dataDirectory: string, input: string): RestoreReport => {
  if (!existsSync(input)) throw new Error(`backup input does not exist: ${input}`)
  const staging = mkdtempSync(join(tmpdir(), "qwbe-restore-"))
  try {
    if (!isArchivePath(input) && !statSync(input).isDirectory()) {
      throw new Error(`backup input must be a directory or .tar.gz: ${input}`)
    }
    stageInput(input, staging)
    const manifest = verifyManifest(staging)
    const files = collectStagedFiles(manifest)
    mkdirSync(dataDirectory, { recursive: true })
    for (const rel of files) {
      if (sqliteFileSet.has(rel)) assertNotInUse(safeDataPath(dataDirectory, rel))
    }
    let restored = 0
    for (const rel of files) {
      const source = safeDataPath(staging, rel)
      const target = safeDataPath(dataDirectory, rel)
      ensureParentDirectory(target)
      replaceFile(source, target, manifest.files.find((entry) => entry.path === rel)?.sha256)
      if (sqliteFileSet.has(rel)) for (const suffix of sqliteSidecars) rmSync(`${target}${suffix}`, { force: true })
      restored += 1
    }
    clearBrowserSessions(join(dataDirectory, "sessions.sqlite"))
    return { dataDirectory, input, scanned: files.length, restored, failed: 0, files }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
