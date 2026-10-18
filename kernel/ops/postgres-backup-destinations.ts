import { lstat, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import { GuardRefusal } from "./postgres-backup-guards.ts"

/**
 * The filesystem preconditions, separated from the database ones.
 *
 * Three questions, all of them asked before anything is written: is `DATA_DIR` a
 * real directory, is the backup destination free, and is the artifact tree empty.
 * Each of them has a silent-success failure mode behind it, which is why none of
 * them creates or deletes anything — they only refuse.
 */

const missing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"


/**
 * `DATA_DIR` has to already be a real directory before anything reads or writes.
 *
 * The failure this prevents is silent and total: with the artifact volume not
 * mounted, or `DATA_DIR` misspelled, a `mkdir(..., { recursive: true })` would
 * create the root inside the container, a backup would collect zero artifacts and
 * report success, and a restore would land the PDFs on a filesystem that
 * disappears with the container while the real volume stays empty. `lstat`, not
 * `stat`: a symlinked root is refused rather than followed.
 */
export const assertDataDirectory = async (dataDirectory: string): Promise<void> => {
  let stats
  try {
    stats = await lstat(dataDirectory)
  } catch (error) {
    if (missing(error)) {
      throw new GuardRefusal(
        `DATA_DIR does not exist: ${dataDirectory}. It is not created here — mount the artifact volume.`,
      )
    }
    throw error
  }
  if (stats.isSymbolicLink()) throw new GuardRefusal(`DATA_DIR is a symbolic link: ${dataDirectory}`)
  if (!stats.isDirectory()) throw new GuardRefusal(`DATA_DIR is not a directory: ${dataDirectory}`)
}

/**
 * The destination is refused BEFORE the dump, not after it.
 *
 * Without this, a ten-minute dump runs and the copy then dies with `EEXIST`
 * half-way, leaving the operator's directory holding a mix of an old backup and a
 * new one that looks like a backup. An archive destination must not exist at all
 * (the writer's `wx` would agree, but only after the dump); a directory
 * destination must be absent or empty, which is the same rule restore applies to
 * its target.
 */
export const assertOutputAvailable = async (output: string, archive: boolean): Promise<void> => {
  let stats
  try {
    stats = await lstat(output)
  } catch (error) {
    if (!missing(error)) throw error
    const parent = dirname(output)
    try {
      if (!(await lstat(parent)).isDirectory()) throw new GuardRefusal(`output parent is not a directory: ${parent}`)
    } catch (parentError) {
      if (missing(parentError)) throw new GuardRefusal(`output parent does not exist: ${parent}`)
      throw parentError
    }
    return
  }
  if (archive) throw new GuardRefusal(`backup output already exists: ${output}. Nothing is overwritten here.`)
  if (!stats.isDirectory()) throw new GuardRefusal(`backup output is not a directory: ${output}`)
  const entries = await readdir(output)
  if (entries.length > 0) {
    throw new GuardRefusal(
      `backup output directory is not empty: ${output} holds ${String(entries.length)} entries. `
      + "Nothing is overwritten or deleted here.",
    )
  }
}

/**
 * The artifact tree must be absent or empty, and "empty" includes files this
 * layout does not know: a stray object next to a content-addressed one is
 * unexplained state, and the restore has no mandate to delete or to merge.
 */
export const assertArtifactsAbsent = async (dataDirectory: string): Promise<void> => {
  let entries: ReadonlyArray<string>
  try {
    entries = await readdir(join(dataDirectory, "artifacts"))
  } catch (error) {
    if (missing(error)) return
    throw error
  }
  if (entries.length > 0) {
    throw new GuardRefusal(
      `restore requires an empty artifact directory; ${join(dataDirectory, "artifacts")} holds `
      + `${String(entries.length)} entries. Nothing is deleted here.`,
    )
  }
}
