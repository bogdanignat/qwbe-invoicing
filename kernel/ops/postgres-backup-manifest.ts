import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ArchiveMember } from "./postgres-backup-archive.ts"
import {
  assertFormatVersion, isStringArray, manifestFormatVersion, organizationIdField, schemaKeys,
} from "./postgres-backup-manifest-fields.ts"
import { ArchiveRejected, dumpMember, manifestMember, safeMemberPath } from "./postgres-backup-paths.ts"
import { assertRestrictedDump } from "./postgres-backup-restrict.ts"

/**
 * The manifest: what the archive claims, in a shape that is checked rather than
 * trusted.
 *
 * It records the versions the artifact was produced with — the `pg_dump` client
 * and the server it ran against — and the schema the dump describes, read from
 * the migration ledger. A restore that reads a manifest from a different major
 * has to refuse, and it cannot refuse on information it did not keep.
 *
 * Checksums are computed by streaming, never by reading a file into memory: the
 * dump of a real database is the largest thing in the archive and the bound on it
 * is a byte bound, not a heap.
 *
 * Format v1: `formatVersion`, `organizationId` and the `scope/name` keys of
 * `schemaMigrations` are defined, and checked, in `postgres-backup-manifest-fields.ts`.
 */

export interface ManifestFile {
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
}

export interface BackupManifest {
  readonly formatVersion: typeof manifestFormatVersion
  readonly organizationId: string
  readonly createdAt: string
  readonly dataDirectory: string
  readonly database: string
  readonly serverVersion: string
  readonly dumpVersion: string
  readonly dumpFormat: "plain"
  readonly excludedTableData: ReadonlyArray<string>
  readonly schemaMigrations: ReadonlyArray<string>
  readonly files: ReadonlyArray<ManifestFile>
}

export const sha256Stream = async (path: string): Promise<string> => {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 16 })) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

export const writeManifest = async (staging: string, manifest: BackupManifest): Promise<string> => {
  const path = join(staging, manifestMember)
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return path
}

const asText = (value: unknown): string => typeof value === "string" ? value : ""

/**
 * The manifest is parsed defensively because it is the one member whose content
 * steers the rest of the restore. A field of the wrong type here would otherwise
 * surface as a confusing failure three steps later, or worse, as a comparison
 * that silently succeeds against `undefined`.
 */
const parseManifest = (text: string): BackupManifest => {
  const value: unknown = JSON.parse(text)
  if (typeof value !== "object" || value === null) throw new ArchiveRejected("manifest is not an object")
  const candidate = value as Record<string, unknown>
  assertFormatVersion(candidate["formatVersion"])
  const organizationId = organizationIdField(candidate["organizationId"])
  const files = candidate["files"]
  if (!Array.isArray(files)) throw new ArchiveRejected("manifest has no file list")
  const parsed: Array<ManifestFile> = files.map((entry: unknown) => {
    const file = entry as Record<string, unknown>
    if (typeof file["path"] !== "string" || typeof file["byteLength"] !== "number"
      || typeof file["sha256"] !== "string" || !/^[0-9a-f]{64}$/u.test(file["sha256"])) {
      throw new ArchiveRejected("manifest file entry is malformed")
    }
    return { path: file["path"], sha256: file["sha256"], byteLength: file["byteLength"] }
  })
  if (candidate["dumpFormat"] !== "plain") throw new ArchiveRejected("manifest declares an unsupported dump format")
  if (typeof candidate["serverVersion"] !== "string" || typeof candidate["dumpVersion"] !== "string") {
    throw new ArchiveRejected("manifest does not record the tool versions")
  }
  const schemaMigrations = schemaKeys(candidate["schemaMigrations"])
  if (!isStringArray(candidate["excludedTableData"])) throw new ArchiveRejected("manifest does not record the exclusions")
  return {
    formatVersion: manifestFormatVersion,
    organizationId,
    createdAt: asText(candidate["createdAt"]),
    dataDirectory: asText(candidate["dataDirectory"]),
    database: asText(candidate["database"]),
    serverVersion: candidate["serverVersion"],
    dumpVersion: candidate["dumpVersion"],
    dumpFormat: "plain",
    excludedTableData: candidate["excludedTableData"],
    schemaMigrations,
    files: parsed,
  }
}

/**
 * The staged tree against its own manifest, both directions.
 *
 * Both directions matter. A missing file is an incomplete backup; a staged file
 * the manifest does not list is extra data smuggled past the whitelist into a
 * name the layout happens to allow, and it is refused rather than ignored. Last,
 * `database.sql` has to sit inside psql's restricted mode (`postgres-backup-restrict.ts`).
 */
export const verifyStaged = async (
  staging: string,
  staged: ReadonlyArray<ArchiveMember>,
): Promise<BackupManifest> => {
  const present = new Set(staged.map((member) => member.path))
  if (!present.has(manifestMember)) throw new ArchiveRejected("backup manifest.json is missing")
  if (!present.has(dumpMember)) throw new ArchiveRejected(`backup ${dumpMember} is missing`)
  const manifest = parseManifest(await readFile(join(staging, manifestMember), "utf8"))
  const listed = new Set<string>()
  for (const entry of manifest.files) {
    if (listed.has(entry.path)) throw new ArchiveRejected(`duplicate manifest entry: ${entry.path}`)
    listed.add(entry.path)
    if (!present.has(entry.path)) throw new ArchiveRejected(`backup file missing from the archive: ${entry.path}`)
    const path = safeMemberPath(staging, entry.path)
    if (await sha256Stream(path) !== entry.sha256) {
      throw new ArchiveRejected(`backup integrity mismatch for ${entry.path}`)
    }
  }
  for (const member of staged) {
    if (member.path !== manifestMember && !listed.has(member.path)) {
      throw new ArchiveRejected(`archive carries a file the manifest does not list: ${member.path}`)
    }
  }
  // The staged copy is the file psql reads: it is the one held to the restricted mode.
  await assertRestrictedDump(join(staging, dumpMember))
  return manifest
}
