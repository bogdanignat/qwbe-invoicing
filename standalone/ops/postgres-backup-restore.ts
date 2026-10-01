import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { assertArtifactsAbsent, assertDataDirectory } from "./postgres-backup-destinations.ts"
import { restoreDatabase } from "./postgres-backup-dump.ts"
import {
  assertEmptyDatabase,
  assertServerMajor16,
  assertSessionsEmpty,
  assertTargetMatches,
} from "./postgres-backup-guards.ts"
import { type BackupManifest, verifyStaged } from "./postgres-backup-manifest.ts"
import { ArchiveRejected, dumpMember, isArtifactMember, manifestMember } from "./postgres-backup-paths.ts"
import { copyTree, inspectTree, stageSource, validateSource } from "./postgres-backup-source.ts"
import { type ArchiveLimits, defaultArchiveLimits } from "./postgres-backup-tar.ts"
import type { BackupSession } from "./postgres-backup-create.ts"

/**
 * Restoring, in the only order that is safe.
 *
 * 1. the input is validated whole — every header, every byte, every name — with
 *    nothing written anywhere;
 * 2. the guards are re-read on the connection that holds the exclusive lock, so a
 *    database that filled up since the dry run is refused here and not there;
 * 3. the input is staged into a private directory and checked against its own
 *    manifest by streaming digest;
 * 4. only then does anything reach the target, and the SQL goes in as one
 *    transaction.
 *
 * Nothing is ever deleted. A populated database or a non-empty artifact tree is a
 * refusal with an instruction, because dropping someone's objects to make room is
 * not a decision this command is allowed to take.
 *
 * ## The trust boundary, stated plainly
 *
 * `database.sql` is **executed**, as the application's own database role. Every
 * check in this module is about the archive as a filesystem object — member names,
 * types, sizes, digests, manifest consistency, tool majors. None of them inspects
 * the SQL, and none of them can: the digests live in the same archive as the file
 * they describe, so they prove the archive is internally consistent and *not* that
 * it came from anybody in particular. An archive an attacker can write is an
 * archive whose SQL runs with the role's full rights.
 *
 * Therefore: restore only from a source you already trust to the same degree as the
 * database itself. `restoreTrustWarning` in `postgres-backup.ts` is the text the CLI
 * is expected to print before `--apply`. Signing the manifest with a locally held
 * key would turn this into an authenticity check; that is deliberately out of scope
 * here and is not implied by anything in this module.
 */

export interface RestoreReport {
  readonly dataDirectory: string
  readonly input: string
  /** Invariants, like `BackupReport`'s: a partial restore throws, it is not reported. */
  readonly scanned: number
  readonly restored: number
  readonly failed: number
  readonly files: ReadonlyArray<string>
}

/**
 * What landed, when a restore failed part-way.
 *
 * The old failure said nothing, and the refusal an operator met on the retry —
 * "requires an empty artifact directory ... Nothing is deleted here" — reads as
 * "nothing happened", which was exactly wrong. Both flags are facts about the
 * target, and `retrySafe` is always false on purpose: this command never writes on
 * top of existing state, so the only resumption is a fresh database and a fresh
 * artifact volume. Nothing is deleted to make that possible.
 */
export class RestoreInterrupted extends Error {
  override readonly name = "RestoreInterrupted"
  /** A destination inside DATA_DIR was opened. Its content may be partial. */
  readonly copyStarted: boolean
  /** At least one artifact was copied whole. */
  readonly dataCopied: boolean
  readonly databaseCommitted: boolean
  readonly retrySafe = false as const

  constructor(
    phase: { readonly copyStarted: boolean; readonly dataCopied: boolean; readonly databaseCommitted: boolean },
    cause: unknown,
  ) {
    const copied = phase.dataCopied
      ? "artifact files were written to DATA_DIR"
      : phase.copyStarted
        ? "an artifact file was opened in DATA_DIR and may be partially written — its size is unknown"
        : "no artifact file was written"
    const landed = [
      copied,
      phase.databaseCommitted ? "the database restore COMMITTED" : "the database was not written",
    ].join("; ")
    super(
      `restore failed part-way (${landed}): ${cause instanceof Error ? cause.message : String(cause)}. `
      + "Retrying in place is not safe and is refused: restore into a fresh database and a fresh artifact "
      + "volume. Nothing is deleted here.",
      { cause },
    )
    this.copyStarted = phase.copyStarted
    this.dataCopied = phase.dataCopied
    this.databaseCommitted = phase.databaseCommitted
  }
}

const restoreTimeoutMillis = 10 * 60_000

/** Read-only, and it never names the target to `psql`. */
export const planRestoreFiles = async (
  session: Omit<BackupSession, "staging">,
  input: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<string>> => {
  const members = await validateSource(input, limits)
  await assertServerMajor16(session.client)
  await assertTargetMatches(session.client, session.settings.database)
  await assertEmptyDatabase(session.client)
  await assertDataDirectory(session.dataDirectory)
  await assertArtifactsAbsent(session.dataDirectory)
  return members.map((member) => member.path).filter((path) => path !== manifestMember)
}

/**
 * The manifest is held to the majors this step verified. A dump written by a
 * different client major is a different dialect of SQL, and a restore that "mostly
 * works" is the failure mode a backup exists to prevent.
 */
const assertCompatible = (manifest: BackupManifest, serverVersion: string): void => {
  const major = (version: string): string => /(\d+)/u.exec(version)?.[1] ?? ""
  if (major(manifest.dumpVersion.replace(/^\D+/u, "")) !== "16") {
    throw new ArchiveRejected(`backup was written by a non-16 client: ${manifest.dumpVersion}`)
  }
  if (major(manifest.serverVersion) !== major(serverVersion)) {
    throw new ArchiveRejected(
      `backup was taken from server ${manifest.serverVersion}, target is ${serverVersion}`,
    )
  }
}

/**
 * A test seam, and nothing else. `afterArtifact` fails the copy between two real
 * files on a real filesystem; `beforeArtifact` fails it at the first one, which is the
 * branch an ENOSPC on the very first artifact takes and the only way to reach it
 * without filling a disc. Production callers pass nothing.
 */
export interface RestoreHooks {
  /** Runs after `copyStarted` is set and before the destination is opened. */
  readonly beforeArtifact?: (path: string) => void
  readonly afterArtifact?: (path: string) => void
}

export const restoreBackup = async (
  session: BackupSession,
  input: string,
  limits: ArchiveLimits = defaultArchiveLimits,
  hooks: RestoreHooks = {},
): Promise<RestoreReport> => {
  await validateSource(input, limits)
  const serverVersion = await assertServerMajor16(session.client)
  await assertTargetMatches(session.client, session.settings.database)
  await assertEmptyDatabase(session.client)
  await assertDataDirectory(session.dataDirectory)
  await assertArtifactsAbsent(session.dataDirectory)
  const staged = await stageSource(input, session.staging, limits)
  const manifest = await verifyStaged(session.staging, staged)
  assertCompatible(manifest, serverVersion)
  await assertEmptyDatabase(session.client)
  await assertArtifactsAbsent(session.dataDirectory)
  // Artifacts first, the database last. The SQL is the commit point: it goes in as
  // one transaction, so if anything above it fails the target is still an empty
  // database and no row can reference a PDF that is not there. Everything from here
  // on reports which half landed, because after this line "nothing happened" stops
  // being true.
  // `copyStarted` is set BEFORE the destination is opened, not after the copy
  // returns. `copyTree` creates its target with `wx` and then writes into it, and it
  // does not unlink a partial file, so an ENOSPC during the FIRST artifact leaves a
  // truncated `.pdf` behind. Reporting that as "no artifact file was written" was
  // exactly the confusion this error exists to remove: the operator would read
  // "nothing happened", retry, and meet "requires an empty artifact directory".
  const phase = { copyStarted: false, dataCopied: false, databaseCommitted: false }
  try {
    const artifacts = (await inspectTree(session.staging, "artifacts", limits))
      .filter((entry) => isArtifactMember(entry.path))
    if (artifacts.length > 0) await mkdir(join(session.dataDirectory, "artifacts"), { recursive: true, mode: 0o700 })
    for (const artifact of artifacts) {
      phase.copyStarted = true
      hooks.beforeArtifact?.(artifact.path)
      await copyTree(session.staging, session.dataDirectory, [artifact])
      phase.dataCopied = true
      hooks.afterArtifact?.(artifact.path)
    }
    await restoreDatabase(session.settings, join(session.staging, dumpMember), restoreTimeoutMillis)
    phase.databaseCommitted = true
    // Past this point the transaction is committed and no check can take it back;
    // a failure here is a report about a restored database, not a rollback.
    await assertSessionsEmpty(session.client)
  } catch (error) {
    if (!phase.copyStarted && !phase.dataCopied && !phase.databaseCommitted) throw error
    throw new RestoreInterrupted(phase, error)
  }
  const files = manifest.files.map((entry) => entry.path)
  return {
    dataDirectory: session.dataDirectory,
    input,
    scanned: files.length,
    restored: files.length,
    failed: 0,
    files,
  }
}
