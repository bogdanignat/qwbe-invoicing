import { stat } from "node:fs/promises"
import { join } from "node:path"

import { digestArchive } from "./postgres-backup-archive.ts"
import { GuardRefusal } from "./postgres-backup-guards.ts"
import { type BackupManifest, type ManifestFile, sha256Stream } from "./postgres-backup-manifest.ts"
import { manifestMember, safeMemberPath } from "./postgres-backup-paths.ts"
import { type ArchiveLimits, blockSize } from "./postgres-backup-tar.ts"

/**
 * What a produced backup is measured against before it is called one.
 *
 * Two questions live here. First, can this project's own restore read what its
 * backup just wrote — the bounds are the reader's, applied to the writer. Second,
 * did the bytes that landed at the destination really land: every member is re-read
 * through the same parser a restore uses and compared with the manifest, so a
 * truncated write, a disk that filled up late, and any drift between the
 * hand-written ustar headers and the reader fail here instead of at the first
 * restore, months later.
 */

export const manifestFiles = async (
  staging: string,
  paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<ManifestFile>> => {
  const files: Array<ManifestFile> = []
  for (const path of paths) {
    const full = safeMemberPath(staging, path)
    files.push({ path, sha256: await sha256Stream(full), byteLength: (await stat(full)).size })
  }
  return files
}

/**
 * The writer is held to the reader's bounds.
 *
 * Without this a 600 MiB dump produces a backup that exits 0 with `failed: 0` and
 * that this project's own restore then refuses with `member exceeds the size
 * bound` — the defect surfacing only when the backup is needed. The bounds are
 * checked on the staged bytes, before anything is packaged, so the refusal names
 * the limit rather than the artifact.
 */
/**
 * The framing the reader counts, which the writer must be measured with.
 *
 * `expandedBlocks` bounds the DECOMPRESSED tar stream, not the sum of the file
 * sizes: every member costs a 512-byte header plus padding to the next block, and the
 * archive ends with two zero blocks. Comparing bare content bytes against
 * `maxExpandedBytes` therefore let a total within ~(members+2)x512 of the limit pass
 * the writer and fail the reader.
 */
const framedBytes = (files: ReadonlyArray<ManifestFile>): number =>
  files.reduce((total, file) => total + blockSize + Math.ceil(file.byteLength / blockSize) * blockSize, 0)
  + blockSize * 2

/**
 * The writer is held to the reader's bounds.
 *
 * Without this a 600 MiB dump produces a backup that exits 0 with `failed: 0` and
 * that this project's own restore then refuses with `member exceeds the size bound` —
 * the defect surfacing only when the backup is needed. The bounds are checked on the
 * staged bytes, including the manifest and the tar framing, before anything is
 * packaged, so the refusal names the limit rather than the artifact.
 */
export const assertWithinLimits = (files: ReadonlyArray<ManifestFile>, limits: ArchiveLimits): void => {
  if (files.length > limits.maxMembers) {
    throw new GuardRefusal(
      `backup would hold ${String(files.length)} members, over the bound of ${String(limits.maxMembers)}`,
    )
  }
  for (const file of files) {
    if (file.byteLength > limits.maxMemberBytes) {
      throw new GuardRefusal(
        `${file.path} is ${String(file.byteLength)} bytes, over the per-member bound of `
        + `${String(limits.maxMemberBytes)}; the restore of such an archive would refuse it`,
      )
    }
  }
  const framed = framedBytes(files)
  if (framed > limits.maxExpandedBytes) {
    throw new GuardRefusal(
      `backup would expand to ${String(framed)} bytes including tar framing, over the bound of `
      + `${String(limits.maxExpandedBytes)}; the restore of such an archive would refuse it`,
    )
  }
}

/**
 * A verification failure names the artifact it left behind.
 *
 * `writeArchive` has already created and fsynced `output` by the time verification
 * runs, and the copy has already populated a directory destination. Saying only
 * "does not match its manifest" sent the operator into `backup output already exists`
 * on the retry with no hint that the file sitting there is an UNVERIFIED backup
 * rather than a good one.
 */
const unverified = (output: string, detail: string): Error =>
  new Error(
    `${detail}. The artifact left at ${output} is UNVERIFIED and must not be trusted as a backup: `
    + "move it aside or remove it before running again. Nothing is removed automatically here.",
  )

/**
 * The artifact is read back and hashed before success is reported.
 *
 * The manifest only ever proved the staging tree. This proves the bytes that landed
 * at the destination: every member is re-read through the same parser a restore uses
 * and its digest is compared with the manifest, so a truncated write, a disk that
 * filled up late, and any drift between the hand-written ustar headers and the reader
 * all fail here instead of at the first restore.
 */
export const verifyArchive = async (
  output: string,
  manifest: BackupManifest,
  limits: ArchiveLimits,
): Promise<void> => {
  let digests: Map<string, string>
  try {
    digests = new Map((await digestArchive(output, limits)).map((member) => [member.path, member.sha256]))
  } catch (error) {
    throw unverified(output, `the written backup could not be read back: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!digests.has(manifestMember)) throw unverified(output, `the written backup is missing ${manifestMember}`)
  for (const file of manifest.files) {
    const actual = digests.get(file.path)
    if (actual === undefined) throw unverified(output, `the written backup is missing ${file.path}`)
    if (actual !== file.sha256) throw unverified(output, `the written backup does not match its manifest for ${file.path}`)
  }
  if (digests.size !== manifest.files.length + 1) {
    throw unverified(
      output,
      `the written backup holds ${String(digests.size)} members, expected ${String(manifest.files.length + 1)}`,
    )
  }
}

export const verifyDirectory = async (output: string, manifest: BackupManifest): Promise<void> => {
  for (const file of manifest.files) {
    if (await sha256Stream(safeMemberPath(output, file.path)) !== file.sha256) {
      throw unverified(output, `the written backup does not match its manifest for ${file.path}`)
    }
  }
  try {
    await stat(join(output, manifestMember))
  } catch {
    throw unverified(output, `the written backup is missing ${manifestMember}`)
  }
}
