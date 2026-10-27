import { ArchiveRejected } from "./postgres-backup-paths.ts"

/**
 * The fields format v1 added to the manifest, each with the one check the parser
 * holds it to.
 *
 * - `formatVersion` is the contract a later image reads by: a manifest without it, or
 *   with another number, is refused rather than guessed at.
 * - `schemaMigrations` holds every ledger row as a `scope/name` key
 *   (`migrationKey`), in the writing image's canonical order, followed by the keys
 *   that image did not know, sorted (`readSchemaMigrations`). No key twice.
 * - `organizationId` is the `ORGANIZATION_ID` the backup was taken under; a restore
 *   under another one is refused.
 */

export const manifestFormatVersion = 1

export const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

/** `migrationKey(scope, name)`: lowercase words joined by hyphens, one `/` between them. */
export const isMigrationKey = (value: string): boolean =>
  value.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)

/**
 * An `ORGANIZATION_ID`: not blank (`kernel/auth/auth.ts`), at most 200 characters and no
 * control character, because the value read from an archive ends up in messages and reports.
 */
export const isOrganizationId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/\p{Cc}/u.test(value)

/** For messages: quoted, so nothing in it can pass for the text around it. */
export const shownOrganization = (value: unknown): string =>
  value === undefined ? "(unset)" : JSON.stringify(typeof value === "string" ? value.slice(0, 80) : value)

export const organizationIdField = (value: unknown): string => {
  if (value === undefined) throw new ArchiveRejected("manifest does not record the organization")
  if (!isOrganizationId(value)) throw new ArchiveRejected(`manifest organizationId is not a valid ORGANIZATION_ID: ${shownOrganization(value)}`)
  return value
}

export const schemaKeys = (value: unknown): ReadonlyArray<string> => {
  if (!isStringArray(value)) throw new ArchiveRejected("manifest does not record the schema")
  const malformed = value.find((key) => !isMigrationKey(key))
  if (malformed !== undefined) throw new ArchiveRejected(`manifest schema key is not scope/name: ${JSON.stringify(malformed.slice(0, 80))}`)
  if (new Set(value).size !== value.length) throw new ArchiveRejected("manifest lists a schema migration twice")
  return value
}

export const assertFormatVersion = (value: unknown): void => {
  if (value === manifestFormatVersion) return
  throw new ArchiveRejected(value === undefined
    ? "manifest has no formatVersion: not a v1 backup archive"
    : `manifest formatVersion ${JSON.stringify(value).slice(0, 40)} is not supported; this image reads ${String(manifestFormatVersion)}`)
}
