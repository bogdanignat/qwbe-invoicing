import { migrationScopes } from "../storage/postgres-migration-plans.ts"
import { canonicalKeys, historyFrom } from "../storage/postgres-schema-fingerprint.ts"
import { type BackupManifest, type ManifestFile, verifyStaged } from "./postgres-backup-manifest.ts"
import { shownOrganization } from "./postgres-backup-manifest-fields.ts"
import { ArchiveRejected, isArtifactMember } from "./postgres-backup-paths.ts"
import { stageSource } from "./postgres-backup-source.ts"
import { type ArchiveLimits, defaultArchiveLimits } from "./postgres-backup-tar.ts"

/**
 * What an archive holds and whether this image can restore it, decided without a
 * database: the archive is staged into the caller's private directory, held to its
 * own manifest by `verifyStaged`, and its schema is compared with the migrations
 * this image ships. No SQL from the archive is read, let alone executed.
 *
 * The comparison is `historyFrom`, the same classifier `migrate` and `doctor` use:
 * - `applied`: the archive's keys this image knows, in the image's order;
 * - `missing`: holes inside a scope — a history this image cannot explain;
 * - `unknown`: keys this image does not know — the archive is newer than the image;
 * - `pending`: the image's migrations after a scope's last applied one, which a
 *   `migrate` after the restore would apply.
 *
 * `restoreBackup` refuses with the same verdict (`assertRestorable`), so the CLI
 * answer and the restore answer cannot disagree.
 */

export interface SchemaComparison {
  readonly applied: ReadonlyArray<string>
  readonly missing: ReadonlyArray<string>
  readonly unknown: ReadonlyArray<string>
  readonly pending: ReadonlyArray<string>
}

export interface BackupInspection {
  readonly input: string
  readonly formatVersion: BackupManifest["formatVersion"]
  readonly createdAt: string
  readonly organizationId: string
  readonly serverVersion: string
  readonly dumpVersion: string
  readonly artifacts: number
  /** The verified inventory: every listed file present with its digest, nothing else in the archive. */
  readonly files: ReadonlyArray<ManifestFile>
  readonly schema: SchemaComparison
  readonly restorable: boolean
  readonly refusal: string | null
}

export const compareSchema = (
  keys: ReadonlyArray<string>,
  scopes: typeof migrationScopes = migrationScopes,
): SchemaComparison => {
  const { applied, missing, unknown } = historyFrom(new Set(keys), scopes)
  const reached = new Set([...applied, ...missing])
  const pending = canonicalKeys(scopes).filter((key) => !reached.has(key))
  return { applied, missing, unknown, pending }
}

export const schemaRefusal = (schema: SchemaComparison): string | null => {
  if (schema.unknown.length > 0) {
    return `the archive is newer than this image, which does not know: ${schema.unknown.join(", ")}`
  }
  if (schema.missing.length > 0) return `the archive's migration history has gaps: ${schema.missing.join(", ")}`
  return null
}

/** The restore's refusal, before anything reaches the target. */
export const assertRestorable = (
  manifest: BackupManifest,
  organizationId: string | undefined,
  scopes: typeof migrationScopes = migrationScopes,
): void => {
  const refusal = schemaRefusal(compareSchema(manifest.schemaMigrations, scopes))
  if (refusal !== null) throw new ArchiveRejected(`backup cannot be restored by this image: ${refusal}`)
  if (manifest.organizationId !== organizationId) {
    throw new ArchiveRejected(
      `backup belongs to organization ${shownOrganization(manifest.organizationId)}, ORGANIZATION_ID is ${shownOrganization(organizationId)}`,
    )
  }
}

/** `staging` is an empty private directory the caller owns and removes. */
export const inspectStaged = async (
  input: string,
  staging: string,
  limits: ArchiveLimits = defaultArchiveLimits,
  scopes: typeof migrationScopes = migrationScopes,
): Promise<BackupInspection> => {
  const manifest = await verifyStaged(staging, await stageSource(input, staging, limits))
  const schema = compareSchema(manifest.schemaMigrations, scopes)
  const refusal = schemaRefusal(schema)
  return {
    input,
    formatVersion: manifest.formatVersion,
    createdAt: manifest.createdAt,
    organizationId: manifest.organizationId,
    serverVersion: manifest.serverVersion,
    dumpVersion: manifest.dumpVersion,
    artifacts: manifest.files.filter((file) => isArtifactMember(file.path)).length,
    files: manifest.files,
    schema,
    restorable: refusal === null,
    refusal,
  }
}
