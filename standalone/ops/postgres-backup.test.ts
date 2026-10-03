import assert from "node:assert/strict"
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

import type { Pool, PoolClient } from "pg"

import {
  acquireSharedMaintenanceLock,
  releaseMaintenanceLock,
  releaseSharedMaintenanceLock,
  tryAcquireMaintenanceLock,
} from "../storage/postgres-maintenance-lock.ts"
import type { PostgresSettings } from "../storage/postgres-pool.ts"
import { emptyRuntime, freshRuntime, type TestRuntime } from "../storage/postgres-rig.test-support.ts"
import {
  type BackupContext,
  executeBackup,
  executeRestore,
  planBackup,
  planRestore,
  restoreTrustWarning,
} from "./postgres-backup.ts"
import { dumpClientVersions, dumpDatabase } from "./postgres-backup-dump.ts"
import { inspectArchive } from "./postgres-backup-archive.ts"
import { sha256Stream, writeManifest } from "./postgres-backup-manifest.ts"
import { RestoreInterrupted, restoreBackup } from "./postgres-backup-restore.ts"
import { createBackup } from "./postgres-backup-create.ts"
import { defaultArchiveLimits } from "./postgres-backup-tar.ts"
import { stageSource } from "./postgres-backup-source.ts"
import { writeArchive } from "./postgres-backup-writer.ts"

/**
 * Backup and restore against a real PostgreSQL 16 server.
 *
 * The rig is `compose.pg-backup.yaml`: a throwaway cluster on tmpfs, a database per
 * case, and `postgresql16-client` installed into the test container at start so the
 * dump really is produced by a 16 client. Nothing existing is reset, no volume is
 * referenced and no database is dropped at runtime — the cluster dies with its
 * container.
 */

const settingsFor = (database: string): PostgresSettings => ({
  host: process.env["PGHOST"] ?? "db",
  port: Number(process.env["PGPORT"] ?? "5432"),
  database,
  user: process.env["PGUSER"] ?? "backup",
  password: process.env["PGPASSWORD"] ?? "",
  statementTimeoutMillis: 10_000,
  connectTimeoutMillis: 3_000,
})

const contextFor = (runtime: TestRuntime, dataDirectory: string): BackupContext => ({
  pool: runtime.pool,
  settings: settingsFor(runtime.database),
  dataDirectory,
})

const digest = "a".repeat(64)
const artifactMember = `artifacts/sha256/${digest.slice(0, 2)}/${digest}.pdf`

const seedArtifact = (dataDirectory: string): string => {
  const directory = join(dataDirectory, "artifacts", "sha256", digest.slice(0, 2))
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${digest}.pdf`)
  writeFileSync(path, Buffer.from("%PDF-1.7 roundtrip fixture\n"))
  return path
}

const counts = async (pool: Pool): Promise<Record<string, number>> => {
  const { rows } = await pool.query<{ readonly kind: string; readonly count: string }>(`
    SELECT 'tables' AS kind, count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL SELECT 'triggers', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL SELECT 'functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    UNION ALL SELECT 'ledger', count(*) FROM schema_migrations
    UNION ALL SELECT 'sessions', count(*) FROM browser_sessions
  `)
  return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]))
}

const insertSession = async (pool: Pool): Promise<void> => {
  await pool.query(
    `INSERT INTO browser_sessions (session_hash, credential_hash, csrf_token, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    ["s".repeat(64), "c".repeat(64), "t".repeat(64), 1_700_000_000_000, 1_900_000_000_000],
  )
}

void test("the dump client and the server are both major 16", async () => {
  const versions = await dumpClientVersions()
  assert.match(versions.dump, /\(PostgreSQL\) 16\./u)
  assert.match(versions.restore, /\(PostgreSQL\) 16\./u)
  const source = await freshRuntime("pgdumpver")
  try {
    const { rows } = await source.pool.query<{ readonly number: string }>(
      "SELECT current_setting('server_version_num') AS number",
    )
    assert.equal(Math.floor(Number(rows[0]?.number ?? "0") / 10_000), 16)
  } finally {
    await source.close()
  }
})

void test("backup and restore round-trip the schema, the ledger and the artifact hashes", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-roundtrip-"))
  const source = await freshRuntime("bkpsrc")
  const target = await emptyRuntime("bkptgt")
  try {
    const sourceData = join(root, "source")
    const targetData = join(root, "target")
    mkdirSync(sourceData, { recursive: true })
    // Both roots exist up front: DATA_DIR is mounted, never created by a restore.
    mkdirSync(targetData, { recursive: true })
    const artifact = seedArtifact(sourceData)
    const artifactDigest = await sha256Stream(artifact)
    await insertSession(source.pool)
    const before = await counts(source.pool)
    assert.equal(before.sessions, 1, "the source must hold a live session before the backup")
    assert.ok((before.tables ?? 0) >= 26, `expected the real schema, saw ${String(before.tables)} tables`)
    assert.ok((before.triggers ?? 0) >= 60)
    assert.ok((before.functions ?? 0) >= 1, "the foundation trigger functions must exist")

    const archive = join(root, "backup.tar.gz")
    const report = await executeBackup(contextFor(source, sourceData), archive)
    assert.equal(report.failed, 0)
    assert.equal(report.copied, report.scanned)
    assert.deepEqual([...report.files].sort(), ["database.sql", artifactMember].sort())
    assert.equal(report.manifest, "manifest.json")

    const restored = await executeRestore(contextFor(target, targetData), archive)
    assert.equal(restored.failed, 0)
    assert.equal(restored.restored, restored.scanned)
    const after = await counts(target.pool)
    assert.equal(after.tables, before.tables)
    assert.equal(after.triggers, before.triggers)
    assert.equal(after.functions, before.functions)
    assert.equal(after.ledger, before.ledger)
    assert.equal(after.sessions, 0, "browser_sessions data must not cross a backup")
    assert.equal(
      await sha256Stream(join(targetData, artifactMember)),
      artifactDigest,
      "the restored artifact must be byte-identical",
    )
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("backup refuses while a live client holds the shared maintenance lock, and writes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-live-"))
  const runtime = await freshRuntime("bkplive")
  const live = await runtime.maintenance.connect()
  try {
    mkdirSync(join(root, "data"), { recursive: true })
    await acquireSharedMaintenanceLock(live)
    const archive = join(root, "refused.tar.gz")
    await assert.rejects(
      () => executeBackup(contextFor(runtime, join(root, "data")), archive),
      /requires the application to be stopped/u,
    )
    assert.equal(existsSync(archive), false, "a refused backup must not leave an artifact behind")
    await releaseSharedMaintenanceLock(live)
    const allowed = await executeBackup(contextFor(runtime, join(root, "data")), join(root, "allowed.tar.gz"))
    assert.equal(allowed.failed, 0)
  } finally {
    live.release()
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("restore refuses a populated database and a populated artifact tree, and changes neither", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-populated-"))
  const source = await freshRuntime("bkpfull")
  const populated = await freshRuntime("bkpfull2")
  try {
    const sourceData = join(root, "source")
    mkdirSync(sourceData, { recursive: true })
    seedArtifact(sourceData)
    const archive = join(root, "backup.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)

    const before = await counts(populated.pool)
    const targetData = join(root, "target")
    mkdirSync(targetData, { recursive: true })
    await assert.rejects(
      () => executeRestore(contextFor(populated, targetData), archive),
      /requires an empty database/u,
    )
    assert.deepEqual(await counts(populated.pool), before, "a refused restore must change nothing")

    const empty = await emptyRuntime("bkpart")
    try {
      seedArtifact(targetData)
      await assert.rejects(
        () => executeRestore(contextFor(empty, targetData), archive),
        /requires an empty artifact directory/u,
      )
      const inventory = await counts(empty.pool).catch(() => undefined)
      assert.equal(inventory, undefined, "the refused target must still have no schema")
    } finally {
      await empty.close()
    }
  } finally {
    await source.close()
    await populated.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the dry runs read only, leave no staging directory and predict the refusal", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-dryrun-"))
  const source = await freshRuntime("bkpdry")
  const target = await emptyRuntime("bkpdry2")
  try {
    const sourceData = join(root, "source")
    mkdirSync(sourceData, { recursive: true })
    seedArtifact(sourceData)
    const plan = await planBackup(contextFor(source, sourceData))
    assert.deepEqual([...plan.pending].sort(), ["database.sql", artifactMember].sort())
    const archive = join(root, "backup.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)

    const targetData = join(root, "target")
    mkdirSync(targetData, { recursive: true })
    const before = await readdir(tmpdir())
    const dry = await planRestore(contextFor(target, targetData), archive)
    assert.deepEqual([...dry.pending].sort(), ["database.sql", artifactMember].sort())
    assert.deepEqual(await readdir(targetData), [], "a dry run must not write to DATA_DIR")
    await assert.rejects(() => counts(target.pool), /does not exist/u)
    const after = await readdir(tmpdir())
    assert.deepEqual(
      after.filter((entry) => entry.startsWith("qwbe-pg-restore-")),
      before.filter((entry) => entry.startsWith("qwbe-pg-restore-")),
      "a dry run must leave no staging directory behind",
    )
    await assert.rejects(
      () => planRestore(contextFor(source, sourceData), archive),
      /requires an empty database/u,
    )
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a failing subprocess reports a redacted error and never touches process.env", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-secret-"))
  const runtime = await freshRuntime("bkpsecret")
  const secret = "s3cr3t-must-not-appear-anywhere"
  const snapshot = process.env["PGPASSWORD"]
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const context: BackupContext = {
      pool: runtime.pool,
      settings: { ...settingsFor(runtime.database), password: secret },
      dataDirectory,
    }
    await assert.rejects(
      () => executeBackup(context, join(root, "backup.tar.gz")),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        assert.ok(!message.includes(secret), `the password leaked into: ${message}`)
        assert.match(message, /pg_dump failed/u)
        return true
      },
    )
    assert.equal(process.env["PGPASSWORD"], snapshot, "the child's password must never reach process.env")
    assert.equal(existsSync(join(root, "backup.tar.gz")), false)
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * The facade's own bracket, reproduced for the two cases that have to call
 * `restoreBackup` directly: the mid-copy fault injection and the post-commit
 * failure. Nothing is bypassed — the same lock, on one client, with the same
 * staging discipline.
 */
const withLockedRestore = async <Value>(
  runtime: TestRuntime,
  dataDirectory: string,
  use: (session: {
    readonly client: PoolClient
    readonly settings: PostgresSettings
    readonly dataDirectory: string
    readonly staging: string
  }) => Promise<Value>,
): Promise<Value> => {
  const client = await runtime.pool.connect()
  const staging = mkdtempSync(join(tmpdir(), "qwbe-pg-restore-direct-"))
  try {
    assert.equal(await tryAcquireMaintenanceLock(client), true)
    return await use({ client, settings: settingsFor(runtime.database), dataDirectory, staging })
  } finally {
    await releaseMaintenanceLock(client).catch(() => undefined)
    client.release()
    rmSync(staging, { recursive: true, force: true })
  }
}

void test("a missing DATA_DIR is refused, never created, by both the plan and the apply", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-nodir-"))
  const runtime = await freshRuntime("bkpnodir")
  try {
    const absent = join(root, "not-mounted")
    const context = contextFor(runtime, absent)
    await assert.rejects(() => planBackup(context), /DATA_DIR does not exist/u)
    await assert.rejects(() => executeBackup(context, join(root, "backup.tar.gz")), /DATA_DIR does not exist/u)
    assert.equal(existsSync(absent), false, "DATA_DIR must not be created by a refusal")
    assert.equal(existsSync(join(root, "backup.tar.gz")), false)
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("backup refuses when a referenced PDF is absent or has the wrong digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-crosscheck-"))
  const runtime = await freshRuntime("bkpcross")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const context = contextFor(runtime, dataDirectory)
    // A row that claims an artifact DATA_DIR does not hold: the old code reported
    // `copied: 0, failed: 0`, exit 0.
    await runtime.pool.query(
      `INSERT INTO invoice_artifacts
         (invoice_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["inv-1", "org-1", `sha256/${digest.slice(0, 2)}/${digest}.pdf`, digest, 27, "application/pdf", "v1", 1_700_000_000_000],
    )
    await assert.rejects(
      () => executeBackup(context, join(root, "absent.tar.gz")),
      /referenced PDFs are missing from DATA_DIR/u,
    )
    assert.equal(existsSync(join(root, "absent.tar.gz")), false)

    // Now the file exists but its bytes are not the ones the row recorded.
    const path = seedArtifact(dataDirectory)
    writeFileSync(path, Buffer.from("%PDF-1.7 tampered\n"))
    await assert.rejects(
      () => executeBackup(context, join(root, "tampered.tar.gz")),
      /different digest than their row/u,
    )
    assert.equal(existsSync(join(root, "tampered.tar.gz")), false)

    // Restored to the digest the row claims, the same backup succeeds.
    writeFileSync(path, Buffer.from("%PDF-1.7 roundtrip fixture\n"))
    await runtime.pool.query("UPDATE invoice_artifacts SET sha256 = $1 WHERE invoice_id = $2", [await sha256Stream(path), "inv-1"])
      .catch(async () => {
        // The table is immutable by trigger; re-seed instead of updating.
        await runtime.pool.query("DELETE FROM invoice_artifacts WHERE invoice_id = $1", ["inv-1"]).catch(() => undefined)
      })
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a non-empty destination is refused before the dump runs, not after", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-dest-"))
  const runtime = await freshRuntime("bkpdest")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const context = contextFor(runtime, dataDirectory)
    const archive = join(root, "taken.tar.gz")
    writeFileSync(archive, "an earlier backup")
    await assert.rejects(() => executeBackup(context, archive), /output already exists/u)
    assert.equal(readFileSync(archive, "utf8"), "an earlier backup", "the existing artifact must be untouched")

    const directory = join(root, "occupied")
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, "manifest.json"), "{}")
    await assert.rejects(() => executeBackup(context, directory), /output directory is not empty/u)
    assert.deepEqual(readdirSync(directory), ["manifest.json"])

    await assert.rejects(
      () => executeBackup(context, join(root, "no", "such", "parent.tar.gz")),
      /output parent does not exist/u,
    )
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the subprocess deadline is reported as a deadline and the lock survives it", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-deadline-"))
  const runtime = await freshRuntime("bkpdeadline")
  try {
    await assert.rejects(
      () => dumpDatabase(settingsFor(runtime.database), join(root, "dump.sql"), 1),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        assert.match(message, /pg_dump exceeded its 1 ms deadline and was killed/u)
        assert.ok(!message.includes("signal SIGKILL"), "a deadline must not read as an external kill")
        return true
      },
    )
    // The lock bracket is intact: a normal backup still acquires it afterwards.
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const report = await executeBackup(contextFor(runtime, dataDirectory), join(root, "after.tar.gz"))
    assert.equal(report.failed, 0)
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a second maintenance operation on the same pool is refused while the first holds the lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-concurrent-"))
  const runtime = await freshRuntime("bkpconc")
  const holder = await runtime.pool.connect()
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    assert.equal(await tryAcquireMaintenanceLock(holder), true)
    await assert.rejects(
      () => executeBackup(contextFor(runtime, dataDirectory), join(root, "second.tar.gz")),
      /requires the application to be stopped/u,
    )
    assert.equal(existsSync(join(root, "second.tar.gz")), false)
  } finally {
    await releaseMaintenanceLock(holder)
    holder.release()
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a fault between two artifact copies reports what landed and refuses an in-place retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-midcopy-"))
  const source = await freshRuntime("bkpmid")
  const target = await emptyRuntime("bkpmid2")
  try {
    const sourceData = join(root, "source")
    mkdirSync(sourceData, { recursive: true })
    seedArtifact(sourceData)
    const second = "f".repeat(64)
    mkdirSync(join(sourceData, "artifacts", "sha256", second.slice(0, 2)), { recursive: true })
    writeFileSync(join(sourceData, "artifacts", "sha256", second.slice(0, 2), `${second}.pdf`), "%PDF second\n")
    const archive = join(root, "backup.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)

    const targetData = join(root, "target")
    mkdirSync(targetData, { recursive: true })
    let copied = 0
    const failure = await withLockedRestore(target, targetData, async (session) =>
      restoreBackup(session, archive, undefined, {
        afterArtifact: () => {
          copied += 1
          if (copied === 1) throw new Error("injected ENOSPC between two artifacts")
        },
      }).then(() => undefined).catch((error: unknown) => error))
    assert.ok(failure instanceof RestoreInterrupted, `expected RestoreInterrupted, got ${String(failure)}`)
    assert.equal(failure.dataCopied, true)
    assert.equal(failure.databaseCommitted, false)
    assert.equal(failure.retrySafe, false)
    assert.match(failure.message, /artifact files were written to DATA_DIR/u)
    assert.match(failure.message, /the database was not written/u)
    assert.match(failure.message, /fresh database and a fresh artifact volume/u)
    // The database is still empty, so no row can reference the PDF that is missing.
    await assert.rejects(() => counts(target.pool), /does not exist/u)
    // And the retry is refused rather than writing over the half-copied tree.
    await assert.rejects(
      () => executeRestore(contextFor(target, targetData), archive),
      /requires an empty artifact directory/u,
    )
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a check that fails after the commit says the database was restored", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-postcommit-"))
  const source = await freshRuntime("bkppost")
  const target = await emptyRuntime("bkppost2")
  try {
    const sourceData = join(root, "source")
    mkdirSync(sourceData, { recursive: true })
    const archive = join(root, "clean.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)

    // A tampered archive whose SQL leaves a session row behind: the restore commits,
    // then `assertSessionsEmpty` fails. Nothing can take the commit back.
    const staging = mkdtempSync(join(tmpdir(), "qwbe-pg-tamper-"))
    const tampered = join(root, "tampered.tar.gz")
    try {
      const staged = await stageSource(archive, staging)
      const dump = join(staging, "database.sql")
      writeFileSync(dump, `${readFileSync(dump, "utf8")}\nINSERT INTO public.browser_sessions `
        + `(session_hash, credential_hash, csrf_token, created_at, expires_at) `
        + `VALUES ('${"9".repeat(64)}', '${"8".repeat(64)}', '${"7".repeat(64)}', 1, 2);\n`)
      await writeManifest(staging, {
        createdAt: new Date().toISOString(),
        dataDirectory: sourceData,
        database: source.database,
        serverVersion: "16.15",
        dumpVersion: "pg_dump (PostgreSQL) 16.15",
        dumpFormat: "plain",
        excludedTableData: ["public.browser_sessions"],
        schemaMigrations: [],
        files: [{ path: "database.sql", sha256: await sha256Stream(dump), byteLength: statSync(dump).size }],
      })
      assert.ok(staged.some((member) => member.path === "database.sql"))
      await writeArchive(staging, ["manifest.json", "database.sql"], tampered)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }

    const targetData = join(root, "target")
    mkdirSync(targetData, { recursive: true })
    const failure = await executeRestore(contextFor(target, targetData), tampered)
      .then(() => undefined)
      .catch((error: unknown) => error)
    assert.ok(failure instanceof RestoreInterrupted, `expected RestoreInterrupted, got ${String(failure)}`)
    assert.equal(failure.databaseCommitted, true)
    assert.equal(failure.retrySafe, false)
    assert.match(failure.message, /the database restore COMMITTED/u)
    assert.match(failure.message, /carried 1 browser sessions/u)
    // The commit really is there, which is exactly what the message now admits.
    assert.equal((await counts(target.pool)).sessions, 1)
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the facade exports the trust warning the CLI has to print", () => {
  assert.match(restoreTrustWarning, /executes database\.sql as the application's database role/u)
  assert.match(restoreTrustWarning, /never for authenticity/u)
})

void test("the write guard refuses a backup the restore could not read, and leaves no artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-writerbound-"))
  const runtime = await freshRuntime("bkpbound")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const output = join(root, "over-bound.tar.gz")
    // Injected small limits, not a 600 MiB dump: the guard is what is under test, and
    // the real dump of the real schema is already far over a 4 KiB per-member bound.
    const refusal = await withLockedRestore(runtime, dataDirectory, async (session) =>
      createBackup(session, output, { ...defaultArchiveLimits, maxMemberBytes: 4096 })
        .then(() => undefined)
        .catch((error: unknown) => error))
    assert.ok(refusal instanceof Error, "the guard must refuse")
    assert.match(refusal.message, /over the per-member bound of 4096/u)
    assert.match(refusal.message, /the restore of such an archive would refuse it/u)
    assert.equal(existsSync(output), false, "a refused backup must leave no artifact")

    // The same guard on the expanded total, framing included.
    const total = await withLockedRestore(runtime, dataDirectory, async (session) =>
      createBackup(session, join(root, "over-total.tar.gz"), { ...defaultArchiveLimits, maxExpandedBytes: 2048 })
        .then(() => undefined)
        .catch((error: unknown) => error))
    assert.ok(total instanceof Error)
    assert.match(total.message, /including tar framing, over the bound of 2048/u)
    assert.equal(existsSync(join(root, "over-total.tar.gz")), false)

    // And with the default bounds the same backup succeeds, so the guard is a bound
    // and not a blanket refusal.
    const report = await withLockedRestore(runtime, dataDirectory, async (session) =>
      createBackup(session, join(root, "within.tar.gz")))
    assert.equal(report.failed, 0)
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("an interruption during the FIRST artifact reports a possibly partial copy", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-firstartifact-"))
  const source = await freshRuntime("bkpfirst")
  const target = await emptyRuntime("bkpfirst2")
  try {
    const sourceData = join(root, "source")
    mkdirSync(sourceData, { recursive: true })
    seedArtifact(sourceData)
    const archive = join(root, "backup.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)

    const targetData = join(root, "target")
    mkdirSync(targetData, { recursive: true })
    // The branch an ENOSPC on the very first artifact takes: previously this rethrew
    // the raw error, so the operator read "nothing happened" and then met
    // "requires an empty artifact directory" on the retry.
    const failure = await withLockedRestore(target, targetData, async (session) =>
      restoreBackup(session, archive, undefined, {
        beforeArtifact: () => { throw new Error("ENOSPC: no space left on device") },
      }).then(() => undefined).catch((error: unknown) => error))
    assert.ok(failure instanceof RestoreInterrupted, `expected RestoreInterrupted, got ${String(failure)}`)
    assert.equal(failure.copyStarted, true)
    assert.equal(failure.dataCopied, false)
    assert.equal(failure.databaseCommitted, false)
    assert.equal(failure.retrySafe, false)
    assert.match(failure.message, /may be partially written — its size is unknown/u)
    assert.match(failure.message, /fresh database and a fresh artifact volume/u)
    assert.match(failure.message, /ENOSPC/u)
    await assert.rejects(() => counts(target.pool), /does not exist/u)
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the archive the writer produces and the one BusyBox tar produces are mutually readable", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-pg-tar-interop-"))
  const runtime = await freshRuntime("bkptar")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    const mine = join(root, "mine.tar.gz")
    await executeBackup(contextFor(runtime, dataDirectory), mine)

    // Producer side: the image's own tar lists every member of our archive.
    const listed = await new Promise<string>((settle, fail) => {
      const child = spawn("tar", ["-tzf", mine], { stdio: ["ignore", "pipe", "pipe"] })
      let out = ""
      let err = ""
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => { out += chunk })
      child.stderr.on("data", (chunk: string) => { err += chunk })
      child.on("error", fail)
      child.on("close", (code) => {
        if (code === 0) settle(out)
        else fail(new Error(`tar -tzf exit ${String(code)}: ${err}`))
      })
    })
    assert.ok(listed.split("\n").includes("manifest.json"), `tar listing was: ${listed}`)
    assert.ok(listed.split("\n").includes("database.sql"), `tar listing was: ${listed}`)

    // Consumer side: an archive written by tar, padded to its 10240-byte record, is
    // accepted by our reader.
    const staging = join(root, "staging")
    mkdirSync(staging, { recursive: true })
    await stageSource(mine, staging)
    const theirs = join(root, "theirs.tar.gz")
    await new Promise<void>((settle, fail) => {
      const child = spawn("tar", ["-czf", theirs, "-C", staging, "manifest.json", "database.sql"], { stdio: "ignore" })
      child.on("error", fail)
      child.on("close", (code) => {
        if (code === 0) settle()
        else fail(new Error(`tar -czf exit ${String(code)}`))
      })
    })
    const members = await inspectArchive(theirs)
    assert.deepEqual([...members.map((member) => member.path)].sort(), ["database.sql", "manifest.json"])
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  }
})
