import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises"
import { dirname, join } from "node:path"

import { type ArchiveMember, extractArchive, inspectArchive } from "./postgres-backup-archive.ts"
import { ArchiveRejected, assertAllowedMember, isArchivePath, safeMemberPath } from "./postgres-backup-paths.ts"
import { type ArchiveLimits, defaultArchiveLimits } from "./postgres-backup-tar.ts"

/**
 * The restore input, in either of its two shapes, behind one pair of functions:
 * `validateSource` decides and writes nothing, `stageSource` copies into a
 * staging directory the caller owns. A directory input is held to the same
 * guarantees as an archive — it is not the safe case, it is the case where the
 * attacker gets to use the filesystem's own indirection instead of a header byte.
 *
 * What a directory is checked for, and why each one is not redundant:
 * - the root is `lstat`ed, so a symlinked input directory is refused before it is
 *   walked and `readdir` never follows it;
 * - `readdir` reports entry types from the directory itself, so a symlink is seen
 *   as a symlink and not as whatever it points at;
 * - a hard link (`nlink > 1`) is refused, because the file's content can be
 *   changed through the other name after it was accepted;
 * - every file's `realpath` must be exactly its expected path, which is how an
 *   intermediate component replaced between the walk and the copy is caught;
 * - the copy opens with `O_NOFOLLOW` and compares `dev`/`ino` against the walk's
 *   `lstat`, so the file swapped in between the two is refused rather than read.
 *
 * There is no legacy shape. An input that is neither `.tar.gz`/`.tgz` nor a
 * directory is refused outright, with no fallback that guesses.
 */

export interface DirectoryEntry extends ArchiveMember {
  readonly dev: number
  readonly ino: number
}

const walk = async (
  root: string,
  resolvedRoot: string,
  relative: string,
  limits: ArchiveLimits,
  found: Array<DirectoryEntry>,
  total: { bytes: number },
): Promise<void> => {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`
    if (entry.isSymbolicLink()) throw new ArchiveRejected(`input contains a symbolic link: ${path}`)
    if (entry.isDirectory()) {
      assertAllowedMember(path, true)
      await walk(root, resolvedRoot, path, limits, found, total)
      continue
    }
    if (!entry.isFile()) throw new ArchiveRejected(`input entry is not a regular file: ${path}`)
    assertAllowedMember(path, false)
    if (found.length + 1 > limits.maxMembers) throw new ArchiveRejected("input exceeds the member bound")
    const full = safeMemberPath(root, path)
    const stats = await lstat(full)
    if (stats.nlink !== 1) throw new ArchiveRejected(`input entry is hard-linked: ${path}`)
    if (stats.size > limits.maxMemberBytes) throw new ArchiveRejected(`input entry exceeds the size bound: ${path}`)
    total.bytes += stats.size
    if (total.bytes > limits.maxExpandedBytes) throw new ArchiveRejected("input exceeds the expanded size bound")
    if (await realpath(full) !== join(resolvedRoot, path)) {
      throw new ArchiveRejected(`input entry resolves outside the input: ${path}`)
    }
    found.push({ path, byteLength: stats.size, dev: stats.dev, ino: stats.ino })
  }
}

const missing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/**
 * Every regular file under `root/start`, validated. `start` is the subtree the
 * caller means: `""` for a restore input, `"artifacts"` when a backup collects the
 * content-addressed PDFs out of `DATA_DIR`. A `start` that does not exist is an
 * empty subtree, not a failure — a database with no rendered document has no
 * artifact directory yet.
 */
export const inspectTree = async (
  root: string,
  start: string,
  limits: ArchiveLimits,
): Promise<ReadonlyArray<DirectoryEntry>> => {
  if (!(await lstat(root)).isDirectory()) throw new ArchiveRejected(`not a directory: ${root}`)
  const found: Array<DirectoryEntry> = []
  try {
    await walk(root, await realpath(root), start, limits, found, { bytes: 0 })
  } catch (error) {
    if (start !== "" && missing(error)) return []
    throw error
  }
  return found
}

export const copyTree = async (
  input: string,
  staging: string,
  entries: ReadonlyArray<DirectoryEntry>,
): Promise<void> => {
  for (const entry of entries) {
    const source = safeMemberPath(input, entry.path)
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stats = await handle.stat()
      if (stats.dev !== entry.dev || stats.ino !== entry.ino) {
        throw new ArchiveRejected(`input entry changed identity during the copy: ${entry.path}`)
      }
      const target = safeMemberPath(staging, entry.path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      const destination = await open(target, "wx", 0o600)
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false })) await destination.write(chunk)
      } finally {
        await destination.close()
      }
    } finally {
      await handle.close()
    }
  }
}

const assertShape = (input: string): void => {
  if (isArchivePath(input)) return
  throw new ArchiveRejected(`backup input must be a directory or .tar.gz: ${input}`)
}

/** Read-only, total: every member of the input, or a refusal. Never writes. */
export const validateSource = async (
  input: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember>> => {
  const stats = await lstat(input)
  if (stats.isDirectory()) return inspectTree(input, "", limits)
  if (!stats.isFile()) throw new ArchiveRejected(`backup input is not a regular file: ${input}`)
  assertShape(input)
  return inspectArchive(input, limits)
}

/**
 * Validates again, then stages. The second validation is the point: the caller's
 * dry run may be minutes old, and the archive on disk is not the caller's.
 */
export const stageSource = async (
  input: string,
  staging: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember>> => {
  const stats = await lstat(input)
  if (stats.isDirectory()) {
    const entries = await inspectTree(input, "", limits)
    await copyTree(input, staging, entries)
    return entries.map((entry) => ({ path: entry.path, byteLength: entry.byteLength }))
  }
  if (!stats.isFile()) throw new ArchiveRejected(`backup input is not a regular file: ${input}`)
  assertShape(input)
  await inspectArchive(input, limits)
  return extractArchive(input, staging, limits)
}
