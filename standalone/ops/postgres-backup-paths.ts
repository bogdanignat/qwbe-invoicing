import { isAbsolute, resolve, sep } from "node:path"

/**
 * The only names a backup may contain, and the only way one becomes a path on
 * disk.
 *
 * The whitelist is positive and total: a member is the manifest, the SQL dump,
 * or a content-addressed PDF whose name is fully determined by its own digest
 * (`standalone/documents/artifact-store.ts:17`). Nothing else is a member, so
 * "unknown entry" needs no catalogue of attacks — it is the default answer.
 *
 * `ArchiveRejected` is raised for every refusal here rather than a plain Error:
 * the restore path has to distinguish "this archive is not acceptable" from "the
 * filesystem failed", and the caller must never turn the first into a partial
 * write.
 */

export class ArchiveRejected extends Error {
  override readonly name = "ArchiveRejected"
}

export const manifestMember = "manifest.json"
export const dumpMember = "database.sql"

/** `artifacts/sha256/<2 hex>/<64 hex>.pdf`, the object key the store writes. */
const artifactMember = /^artifacts\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/u

export const isArtifactMember = (path: string): boolean => artifactMember.test(path)

/** `.<sha256>.<uuid>.tmp`, the name `standalone/documents/artifact-store.ts:42` stages under. */
const storeTemporary =
  /^artifacts\/sha256\/[0-9a-f]{2}\/\.[0-9a-f]{64}\.[0-9a-f-]{36}\.tmp$/u

/**
 * A member name, judged as text before it is ever joined to a directory.
 *
 * The checks that look redundant next to the whitelist are not: they run first,
 * so the reason reported for `../../etc/passwd` is traversal rather than a
 * generic mismatch, and a name carrying a newline or a NUL is refused before any
 * code is tempted to print or split it. A directory entry is accepted only as
 * one of the two prefixes the layout has.
 */
export const assertAllowedMember = (path: string, directory: boolean): void => {
  if (path.length === 0) throw new ArchiveRejected("member name is empty")
  if (path.includes("\0")) throw new ArchiveRejected("member name contains NUL")
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      throw new ArchiveRejected(`member name contains a control character: ${JSON.stringify(path)}`)
    }
  }
  if (path.includes("\\")) throw new ArchiveRejected(`member name contains a backslash: ${JSON.stringify(path)}`)
  if (isAbsolute(path) || path.startsWith("/")) throw new ArchiveRejected(`member name is absolute: ${path}`)
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new ArchiveRejected(`member name traverses: ${path}`)
  }
  if (path.includes("//")) throw new ArchiveRejected(`member name has an empty segment: ${path}`)
  if (directory) {
    if (path !== "artifacts" && !/^artifacts\/sha256(\/[0-9a-f]{2})?$/u.test(path)) {
      throw new ArchiveRejected(`directory is not part of the layout: ${path}`)
    }
    return
  }
  // Ahead of the 100-byte check on purpose: the limit is a ustar header constraint,
  // and this file is found by walking a directory, where the name is legal and 126
  // characters long. Diagnosing it as "too long" would have hidden what it is.
  //
  // The whitelist is NOT relaxed for it, but a leftover temporary of the artifact
  // store gets its own diagnosis. `artifact-store.ts:42` writes
  // `.<sha256>.<uuid>.tmp` next to the object it is about to rename into place and
  // removes it in a `finally`; a SIGKILL or a power loss in between leaves the file,
  // and the generic refusal then blocked every backup with no instruction. A real
  // PDF is never named like this, so nothing legitimate is swept up.
  if (storeTemporary.test(path)) {
    throw new ArchiveRejected(
      `${path} is a leftover temporary file of the artifact store, not an artifact. `
      + "It is from an interrupted render and carries no document: remove that one file and run again. "
      + "Nothing is removed automatically here.",
    )
  }
  if (path.length > 100) throw new ArchiveRejected("member name is too long")
  if (path === manifestMember || path === dumpMember || isArtifactMember(path)) return
  throw new ArchiveRejected(`member is not part of the layout: ${path}`)
}

/**
 * The path a validated member occupies under `root`.
 *
 * The containment check is kept even though the name was already whitelisted:
 * it is the invariant the extraction depends on, and it costs one comparison.
 */
export const safeMemberPath = (root: string, path: string): string => {
  const base = resolve(root)
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new ArchiveRejected(`member escapes the staging root: ${path}`)
  }
  return target
}

export const isArchivePath = (path: string): boolean => path.endsWith(".tar.gz") || path.endsWith(".tgz")
