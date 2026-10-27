import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { type BackupManifest, sha256Stream, verifyStaged, writeManifest } from "./postgres-backup-manifest.ts"
import { ArchiveRejected } from "./postgres-backup-paths.ts"
import { registryCheckSql } from "./postgres-backup-registry.ts"

/** Manifest format v1, written and read back, and every field the parser now refuses. */

const staged = [{ path: "manifest.json", byteLength: 1 }, { path: "database.sql", byteLength: 10 }]

const withStaging = async (use: (staging: string, manifest: BackupManifest) => Promise<void>): Promise<void> => {
  const staging = mkdtempSync(join(tmpdir(), "qwbe-manifest-"))
  try {
    writeFileSync(join(staging, "database.sql"), "SELECT 1;\n")
    await use(staging, {
      formatVersion: 1,
      organizationId: "org-test",
      createdAt: "2026-10-01T00:00:00.000Z",
      dataDirectory: "/data",
      database: "invoicing",
      serverVersion: "16.15",
      dumpVersion: "pg_dump (PostgreSQL) 16.15",
      dumpFormat: "plain",
      excludedTableData: ["public.browser_sessions"],
      schemaMigrations: ["foundation/000-foundation", "kernel/000-browser-sessions"],
      files: [{ path: "database.sql", sha256: await sha256Stream(join(staging, "database.sql")), byteLength: 10 }],
    })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const without = (manifest: BackupManifest, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(manifest).filter(([name]) => name !== field))

const refused = async (staging: string, manifest: Record<string, unknown>, expected: RegExp): Promise<void> => {
  writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest))
  await assert.rejects(() => verifyStaged(staging, staged), (error: unknown) => {
    assert.ok(error instanceof ArchiveRejected, `expected ArchiveRejected, got ${String(error)}`)
    assert.match(error.message, expected)
    return true
  })
}

void test("a v1 manifest is written and read back whole", async () => {
  await withStaging(async (staging, manifest) => {
    await writeManifest(staging, manifest)
    assert.deepEqual(await verifyStaged(staging, staged), manifest)
  })
})

void test("the parser refuses another format version, a key without scope and a missing organization", async () => {
  await withStaging(async (staging, manifest) => {
    await refused(staging, without(manifest, "formatVersion"), /no formatVersion: not a v1 backup archive/u)
    await refused(staging, { ...manifest, formatVersion: 2 }, /formatVersion 2 is not supported; this image reads 1/u)
    await refused(staging, { ...manifest, formatVersion: "1" }, /formatVersion "1" is not supported/u)
    for (const key of ["000-foundation", "foundation/000 foundation", "Foundation/000", "a/b/c", "../x", "foundation/"]) {
      await refused(staging, { ...manifest, schemaMigrations: [key] }, /schema key is not scope\/name/u)
    }
    await refused(staging, { ...manifest, schemaMigrations: ["kernel/000-x", "kernel/000-x"] }, /schema migration twice/u)
    await refused(staging, without(manifest, "organizationId"), /does not record the organization/u)
    await refused(staging, { ...manifest, organizationId: "  " }, /not a valid ORGANIZATION_ID: " {2}"$/u)
    await refused(staging, { ...manifest, organizationId: 7 }, /organizationId is not a valid ORGANIZATION_ID: 7$/u)
    await refused(staging, { ...manifest, organizationId: "o".repeat(201) }, /organizationId is not a valid ORGANIZATION_ID: "o{80}"$/u)
    await refused(staging, { ...manifest, organizationId: "org\nforged: line" }, /not a valid ORGANIZATION_ID: "org\\nforged: line"$/u)
    await refused(staging, { ...manifest, organizationId: "org\u0007" }, /not a valid ORGANIZATION_ID: "org\\u0007"$/u)
    writeFileSync(join(staging, "manifest.json"), JSON.stringify({ ...manifest, organizationId: "o".repeat(200) }))
    assert.equal((await verifyStaged(staging, staged)).organizationId, "o".repeat(200), "200 characters are accepted")
  })
})

void test("the in-transaction ledger check is built only from scope/name keys", () => {
  assert.match(registryCheckSql(["foundation/000-foundation"]), /ARRAY\['foundation\/000-foundation'\]::text\[\]/u)
  assert.match(registryCheckSql([]), /ARRAY\[\]::text\[\]/u)
  assert.throws(() => registryCheckSql(["kernel/x'); DROP TABLE x; --"]), ArchiveRejected)
  assert.throws(() => registryCheckSql(["kernel/$registry$"]), ArchiveRejected)
})
