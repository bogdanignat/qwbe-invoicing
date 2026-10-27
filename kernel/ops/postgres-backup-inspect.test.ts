import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { migrationKey, migrationScopes } from "../storage/postgres-migration-plans.ts"
import { freshRuntime, testSettings } from "../storage/postgres-rig.test-support.ts"
import { executeBackup, inspectBackup } from "./postgres-backup.ts"
import { sha256Stream, writeManifest } from "./postgres-backup-manifest.ts"
import { ArchiveRejected } from "./postgres-backup-paths.ts"
import { defaultArchiveLimits } from "./postgres-backup-tar.ts"
import { writeArchive } from "./postgres-backup-writer.ts"

/**
 * `backup-inspect`: an archive judged with no database — its inventory against its
 * manifest, its schema against the image. The gap and unknown cases inject scopes
 * into `historyFrom`, as `postgres-history-drift.test.ts` does, because every real
 * scope has a single baseline today.
 */

const imageKeys = migrationScopes.flatMap(({ scope, migrations }) => migrations.map(({ name }) => migrationKey(scope, name)))

const scopeFixture = [
  { scope: "alpha", migrations: [{ name: "001", statements: [] }, { name: "002", statements: [] }], tables: [] },
  { scope: "beta", migrations: [{ name: "001", statements: [] }, { name: "002", statements: [] }], tables: [] },
] as unknown as typeof migrationScopes

const pdf = `artifacts/sha256/ab/${"ab".repeat(32)}.pdf`

/** An archive written like a backup writes one, with the schema keys and members the case needs. */
const craftArchive = async (
  root: string,
  name: string,
  schemaMigrations: ReadonlyArray<string>,
  tamper: { readonly digest?: boolean; readonly extra?: boolean } = {},
): Promise<string> => {
  const source = join(root, `${name}-source`)
  mkdirSync(join(source, "artifacts", "sha256", "ab"), { recursive: true })
  writeFileSync(join(source, "database.sql"), "SELECT 1;\n")
  writeFileSync(join(source, pdf), "%PDF-1.7 inspect fixture\n")
  await writeManifest(source, {
    formatVersion: 1,
    organizationId: "org-test",
    createdAt: "2026-10-01T00:00:00.000Z",
    dataDirectory: "/data",
    database: "qwbe_invoicing",
    serverVersion: "16.15",
    dumpVersion: "pg_dump (PostgreSQL) 16.15",
    dumpFormat: "plain",
    excludedTableData: ["public.browser_sessions"],
    schemaMigrations,
    files: [{
      path: "database.sql",
      sha256: tamper.digest === true ? "0".repeat(64) : await sha256Stream(join(source, "database.sql")),
      byteLength: 10,
    }],
  })
  const archive = join(root, `${name}.tar.gz`)
  await writeArchive(source, ["manifest.json", "database.sql", ...(tamper.extra === true ? [pdf] : [])], archive)
  return archive
}

const stagingLeft = (): ReadonlyArray<string> => readdirSync(tmpdir()).filter((entry) => entry.startsWith("qwbe-pg-inspect-"))

void test("an archive made by backup inspects as restorable, with its inventory and metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-inspect-real-"))
  const source = await freshRuntime("inspreal")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(join(dataDirectory, "artifacts", "sha256", "ab"), { recursive: true })
    writeFileSync(join(dataDirectory, pdf), "%PDF-1.7 inspect fixture\n")
    const archive = join(root, "backup.tar.gz")
    await executeBackup({
      pool: source.pool, settings: testSettings(source.database), dataDirectory, organizationId: "org-test",
    }, archive)
    const before = stagingLeft()
    const report = await inspectBackup(archive)
    assert.deepEqual(stagingLeft(), before, "the inspection leaves no staging directory")
    assert.equal(report.restorable, true)
    assert.equal(report.refusal, null)
    assert.equal(report.formatVersion, 1)
    assert.equal(report.organizationId, "org-test")
    assert.match(report.serverVersion, /^16\./u)
    assert.match(report.dumpVersion, /\(PostgreSQL\) 16\./u)
    assert.equal(report.artifacts, 1)
    assert.deepEqual(report.files.map((file) => file.path).sort(), ["database.sql", pdf].sort())
    assert.deepEqual(report.schema, { applied: imageKeys, missing: [], unknown: [], pending: [] })
  } finally {
    await source.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the schema verdict: pending is restorable, an unknown migration or a gap is not", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-inspect-schema-"))
  try {
    const inspect = async (name: string, keys: ReadonlyArray<string>) =>
      inspectBackup(await craftArchive(root, name, keys), defaultArchiveLimits, scopeFixture)

    const behind = await inspect("behind", ["alpha/001", "beta/001"])
    assert.equal(behind.restorable, true)
    assert.deepEqual(behind.schema, { applied: ["alpha/001", "beta/001"], missing: [], unknown: [], pending: ["alpha/002", "beta/002"] })

    const newer = await inspect("newer", ["alpha/001", "alpha/002", "gamma/001"])
    assert.equal(newer.restorable, false)
    assert.deepEqual(newer.schema.unknown, ["gamma/001"])
    assert.match(newer.refusal ?? "", /newer than this image, which does not know: gamma\/001/u)

    const gap = await inspect("gap", ["alpha/002", "beta/001"])
    assert.equal(gap.restorable, false)
    assert.deepEqual(gap.schema, { applied: ["alpha/002", "beta/001"], missing: ["alpha/001"], unknown: [], pending: ["beta/002"] })
    assert.match(gap.refusal ?? "", /migration history has gaps: alpha\/001/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a modified archive is refused, and its staging is removed", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-inspect-tampered-"))
  try {
    const before = stagingLeft()
    for (const [tamper, expected] of [
      [{ digest: true }, /integrity mismatch for database.sql/u],
      [{ extra: true }, /archive carries a file the manifest does not list/u],
    ] as const) {
      const archive = await craftArchive(root, Object.keys(tamper).join(""), imageKeys, tamper)
      await assert.rejects(() => inspectBackup(archive), (error: unknown) => {
        assert.ok(error instanceof ArchiveRejected, `expected ArchiveRejected, got ${String(error)}`)
        assert.match(error.message, expected)
        return true
      })
    }
    assert.deepEqual(stagingLeft(), before, "a refused inspection leaves no staging directory")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("backup-inspect runs with no database setting and no secret, and exits by the verdict", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-inspect-cli-"))
  try {
    // Production, and nothing else: `runtimeConfig` would refuse this environment
    // (no PGPASSWORD_FILE), so a pass proves the command never reads it.
    const run = (...args: ReadonlyArray<string>) => spawnSync(process.execPath,
      [join(process.cwd(), "bin", "qwbe-invoicing.ts"), "backup-inspect", ...args],
      { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", NODE_ENV: "production" } })

    const good = await craftArchive(root, "good", imageKeys)
    const json = run("--input", good, "--json")
    assert.equal(json.status, 0, json.stderr)
    const report = JSON.parse(json.stdout) as { readonly restorable: boolean; readonly organizationId: string }
    assert.equal(report.restorable, true)
    assert.equal(report.organizationId, "org-test")
    const text = run("--input", good)
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, /restorable: true/u)

    const newer = run("--input", await craftArchive(root, "newer", [...imageKeys, "kernel/001-from-the-future"]), "--json")
    assert.equal(newer.status, 2)
    assert.equal((JSON.parse(newer.stdout) as { readonly restorable: boolean }).restorable, false)
    assert.match(newer.stderr, /cannot be restored by this image: .*does not know: kernel\/001-from-the-future/u)

    const tampered = run("--input", await craftArchive(root, "tampered", imageKeys, { digest: true }))
    assert.equal(tampered.status, 2)
    assert.match(tampered.stderr, /integrity mismatch for database.sql/u)

    const usage = run()
    assert.equal(usage.status, 2)
    assert.match(usage.stderr, /backup-inspect requires --input/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
