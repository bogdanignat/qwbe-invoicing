import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import type { PoolClient } from "pg"

import type { PostgresSettings } from "../storage/postgres-pool.ts"
import { assertDataDirectory, assertOutputAvailable } from "./postgres-backup-destinations.ts"
import { dumpClientVersions, dumpDatabase, excludedTableData } from "./postgres-backup-dump.ts"
import {
  assertArtifactsComplete,
  assertServerMajor16,
  assertSinglePublicSchema,
  assertTargetMatches,
  readSchemaMigrations,
} from "./postgres-backup-guards.ts"
import { type BackupManifest, writeManifest } from "./postgres-backup-manifest.ts"
import { dumpMember, isArchivePath, manifestMember } from "./postgres-backup-paths.ts"
import { copyTree, inspectTree } from "./postgres-backup-source.ts"
import { type ArchiveLimits, defaultArchiveLimits } from "./postgres-backup-tar.ts"
import { assertWithinLimits, manifestFiles, verifyArchive, verifyDirectory } from "./postgres-backup-verify.ts"
import { writeArchive } from "./postgres-backup-writer.ts"

/**
 * Producing a backup, with the exclusive maintenance lock already held by the
 * client this is given.
 *
 * The whole operation runs inside that one hold: the dump and the artifact copy are
 * one consistent pair, not two snapshots taken at different times, because a
 * document rendered between them would appear in the artifact tree with no row to
 * explain it. Taking the lock, releasing it and discarding the staging directory are
 * the caller's (`postgres-backup.ts`); this function only ever adds files to the
 * staging directory it is handed, plus the one destination it was asked for.
 */

export interface BackupReport {
  readonly dataDirectory: string
  readonly output: string
  /**
   * `scanned`, `copied` and `failed` are invariants, not counters, and the CLI
   * contract is the only reason they exist: every failure in this path throws, so
   * `copied` always equals `scanned` and `failed` is always 0. A partial backup is
   * not a reportable outcome here — it is an exception.
   */
  readonly scanned: number
  readonly copied: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
  /**
   * For a directory output, the manifest's path. For an archive, its member name:
   * the staging copy is gone by the time the report is read, and naming a path that
   * no longer exists would be worse than naming the member.
   */
  readonly manifest: string
}

export interface BackupSession {
  readonly client: PoolClient
  readonly settings: PostgresSettings
  readonly dataDirectory: string
  readonly staging: string
}

const dumpTimeoutMillis = 10 * 60_000

/**
 * What a backup would contain, read without the lock and without writing.
 *
 * Deliberately lock-free: an operator inspecting the contents of a future backup
 * while the application serves traffic should get an answer, not a refusal. The
 * refusal belongs to `executeBackup`, which is the one that needs the application
 * stopped.
 */
export const planBackupFiles = async (
  dataDirectory: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<string>> => {
  await assertDataDirectory(dataDirectory)
  const artifacts = await inspectTree(dataDirectory, "artifacts", limits)
  return [dumpMember, ...artifacts.map((entry) => entry.path)]
}

export const createBackup = async (
  session: BackupSession,
  output: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<BackupReport> => {
  const archive = isArchivePath(output)
  await assertDataDirectory(session.dataDirectory)
  await assertOutputAvailable(output, archive)
  const versions = await dumpClientVersions()
  const serverVersion = await assertServerMajor16(session.client)
  await assertTargetMatches(session.client, session.settings.database)
  await assertSinglePublicSchema(session.client)
  const schemaMigrations = await readSchemaMigrations(session.client)
  await dumpDatabase(session.settings, join(session.staging, dumpMember), dumpTimeoutMillis)
  const artifacts = await inspectTree(session.dataDirectory, "artifacts", limits)
  await copyTree(session.dataDirectory, session.staging, artifacts)
  const paths = [dumpMember, ...artifacts.map((entry) => entry.path)]
  const files = await manifestFiles(session.staging, paths)
  await assertArtifactsComplete(
    session.client,
    new Map(files.filter((file) => file.path !== dumpMember).map((file) => [file.path, file.sha256])),
  )
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    dataDirectory: session.dataDirectory,
    database: session.settings.database,
    serverVersion,
    dumpVersion: versions.dump,
    dumpFormat: "plain",
    excludedTableData: [...excludedTableData],
    schemaMigrations,
    files,
  }
  await writeManifest(session.staging, manifest)
  // After the manifest exists, so the bound covers every member the reader will see —
  // the manifest included — and the tar framing around them.
  assertWithinLimits(await manifestFiles(session.staging, [manifestMember, ...paths]), limits)
  if (archive) {
    await writeArchive(session.staging, [manifestMember, ...paths], output)
    await verifyArchive(output, manifest, limits)
  } else {
    await mkdir(output, { recursive: true, mode: 0o700 })
    await copyTree(session.staging, output, await inspectTree(session.staging, "", limits))
    await verifyDirectory(output, manifest)
  }
  return {
    dataDirectory: session.dataDirectory,
    output,
    scanned: paths.length,
    copied: paths.length,
    failed: 0,
    files: paths,
    manifest: archive ? manifestMember : join(output, manifestMember),
  }
}
