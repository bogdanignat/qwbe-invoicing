import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { emptyRuntime, freshRuntime, testSettings, type TestRuntime } from "../storage/postgres-rig.test-support.ts"
import { type BackupContext, executeBackup, executeRestore, inspectBackup, planRestore } from "./postgres-backup.ts"
import { dumpDatabase } from "./postgres-backup-dump.ts"
import { type BackupManifest, sha256Stream, writeManifest } from "./postgres-backup-manifest.ts"
import { ArchiveRejected } from "./postgres-backup-paths.ts"
import { assertRestrictedDump, restrictScan } from "./postgres-backup-restrict.ts"
import { restrictedDump, restrictKey } from "./postgres-backup-restrict.test-support.ts"
import { stageSource } from "./postgres-backup-source.ts"
import { writeArchive } from "./postgres-backup-writer.ts"

/**
 * `database.sql` is restored only inside psql's restricted mode: the scan on its own,
 * fed whole and one byte at a time, then a real dump and a hostile archive end to end.
 */

const scanned = (text: string, chunk: number): void => {
  const scan = restrictScan()
  const bytes = Buffer.from(text, "utf8")
  for (let offset = 0; offset < bytes.length; offset += chunk) scan.feed(bytes.subarray(offset, offset + chunk))
  scan.finish()
}

const accepted = (text: string): void => {
  for (const chunk of [1, 7, 1 << 16]) scanned(text, chunk)
}

const refusedWith = (text: string, expected: RegExp): void => {
  for (const chunk of [1, 7, 1 << 16]) {
    assert.throws(() => { scanned(text, chunk) }, (error: unknown) => {
      assert.ok(error instanceof ArchiveRejected, `expected ArchiveRejected, got ${String(error)}`)
      assert.match(error.message, expected)
      return true
    })
  }
}

const otherKey = "Zz9".repeat(21)

void test("a dump outside psql's restricted mode is refused", () => {
  refusedWith("SELECT 1;\n", /does not open with a \\restrict line/u)
  refusedWith("", /has no \\restrict line/u)
  refusedWith("--\n-- comments only\n\n", /has no \\restrict line/u)
  refusedWith(`\\! id\n${restrictedDump()}`, /does not open with a \\restrict line/u)
  refusedWith(`SELECT 1; \\! id\n${restrictedDump()}`, /does not open with a \\restrict line/u)
  refusedWith(restrictedDump("SELECT 1;\n", "short"), /does not open with a \\restrict line/u)
  refusedWith(`\\restrict ${restrictKey}\nSELECT 1;\n`, /does not end with the \\unrestrict line/u)
})

void test("a \\unrestrict anywhere but the closing line is refused", () => {
  const escape = `\\unrestrict ${restrictKey}\n\\! id\n`
  refusedWith(restrictedDump(escape), /continues after \\unrestrict/u)
  refusedWith(restrictedDump(`SELECT 1; \\unrestrict ${restrictKey}\n\\! id\n`), /not the closing line/u)
  refusedWith(restrictedDump(`SELECT 1;\\\\\\unrestrict ${restrictKey}\n`), /not the closing line/u)
  refusedWith(`${restrictedDump()}\\unrestrict ${restrictKey}\n`, /continues after \\unrestrict/u)
  refusedWith(`${restrictedDump()}SELECT 1;\n`, /continues after \\unrestrict/u)
  refusedWith(restrictedDump().replace(`\\unrestrict ${restrictKey}`, `\\unrestrict ${otherKey}`), /not the closing line/u)
})

void test("a NUL byte is refused: psql would join the lines around it", () => {
  // psql reads `--` + `\restrict ...` as one comment line, so `\!` runs unrestricted.
  refusedWith(`--\0X\n\\restrict ${restrictKey}\n\\! echo PWNED\nSELECT 1;\n\\unrestrict ${restrictKey}\n`, /contains a NUL byte/u)
  // psql reads `\` + `unrestrict <key>` as one line and leaves the restricted mode early.
  refusedWith(restrictedDump(`SELECT 1; \\\0\nunrestrict ${restrictKey}\n\\! echo PWNED\n`), /contains a NUL byte/u)
})

void test("the pg_dump frame is accepted, with escaped backslashes in COPY data", () => {
  accepted(restrictedDump())
  accepted(restrictedDump(`COPY "public"."notes" ("body") FROM stdin;\n\\\\unrestrict ${restrictKey}\n\\\\! id\n\\.\n`))
  accepted(restrictedDump("COPY \"public\".\"notes\" (\"body\") FROM stdin;\ntext\\\\\\\\unrestrict x\n\\.\n"))
  accepted(`\n-- leading comment\n\n${restrictedDump().slice(3)}`)
})

void test("a dump written by pg_dump is in restricted mode, COPY data with \\unrestrict included", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-restrict-dump-"))
  const source = await freshRuntime("rstdump")
  try {
    await source.pool.query("CREATE TABLE restrict_probe (body text)")
    await source.pool.query("INSERT INTO restrict_probe VALUES ($1), ($2)", [`\\unrestrict ${restrictKey}`, "\\! id"])
    const dump = join(root, "database.sql")
    await dumpDatabase(testSettings(source.database), dump, 60_000)
    const sql = readFileSync(dump, "utf8")
    assert.match(sql, /^(?:--[^\n]*\n|\n)*\\restrict [A-Za-z0-9]{63}\n/u, "pg_dump opens with \\restrict")
    assert.match(sql, /\n\\unrestrict [A-Za-z0-9]{63}\n\s*$/u, "pg_dump closes with \\unrestrict")
    assert.ok(sql.includes(`\\\\unrestrict ${restrictKey}`), "COPY doubles the backslash of the data")
    await assertRestrictedDump(dump)
  } finally {
    await source.close()
    rmSync(root, { recursive: true, force: true })
  }
})

const contextFor = (runtime: TestRuntime, dataDirectory: string): BackupContext => ({
  pool: runtime.pool, settings: testSettings(runtime.database), dataDirectory, organizationId: "org-test",
})

/** A real backup with its dump edited to run a shell command, re-signed so only the edit is wrong. */
const hostileArchive = async (archive: string, output: string, edit: (sql: string) => string): Promise<string> => {
  const staging = mkdtempSync(join(tmpdir(), "qwbe-restrict-edit-"))
  try {
    const members = (await stageSource(archive, staging)).map((member) => member.path)
    const dump = join(staging, "database.sql")
    writeFileSync(dump, edit(readFileSync(dump, "utf8")))
    const manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8")) as BackupManifest
    await writeManifest(staging, {
      ...manifest,
      files: await Promise.all(manifest.files.map(async (file) => file.path !== "database.sql" ? file
        : { ...file, sha256: await sha256Stream(dump), byteLength: statSync(dump).size })),
    })
    await writeArchive(staging, members, output)
    return output
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const rejectsArchive = async (run: () => Promise<unknown>, expected: RegExp): Promise<void> => {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ArchiveRejected, `expected ArchiveRejected, got ${String(error)}`)
    assert.match(error.message, expected)
    return true
  })
}

void test("a backup whose dump the restore would refuse fails when it is made, and writes no archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-restrict-backup-"))
  const source = await freshRuntime("rstbkp")
  try {
    const dataDirectory = join(root, "data")
    mkdirSync(dataDirectory, { recursive: true })
    await source.pool.query(String.raw`COMMENT ON TABLE schema_migrations IS 'see \unrestrict'`)
    const output = join(root, "backup.tar.gz")
    await rejectsArchive(() => executeBackup(contextFor(source, dataDirectory), output), /carries a \\unrestrict/u)
    assert.equal(existsSync(output), false, "an unrestorable backup leaves no archive")
  } finally {
    await source.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a hostile dump is refused by backup-inspect, the dry run and --apply, before the target", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-restrict-hostile-"))
  const source = await freshRuntime("rsthost")
  const target = await emptyRuntime("rsthost2")
  try {
    const sourceData = join(root, "source")
    const targetData = join(root, "target")
    mkdirSync(sourceData, { recursive: true })
    mkdirSync(targetData, { recursive: true })
    const archive = join(root, "backup.tar.gz")
    await executeBackup(contextFor(source, sourceData), archive)
    const sentinel = join(root, "pwned")
    const variants = [
      [(sql: string) => `\\! touch ${sentinel}\n${sql}`, /database\.sql does not open with a \\restrict line/u],
      // The NUL makes psql read `--` and `\restrict <key>` as one comment line.
      [(sql: string) => sql.replace(/\n(\\restrict [^\n]*\n)/u, `\n--\0X\n$1\\! touch ${sentinel}\n`), /database\.sql contains a NUL byte/u],
    ] as const
    for (const [index, [edit, expected]] of variants.entries()) {
      const hostile = await hostileArchive(archive, join(root, `hostile-${String(index)}.tar.gz`), edit)
      await rejectsArchive(() => inspectBackup(hostile), expected)
      await rejectsArchive(() => planRestore(contextFor(target, targetData), hostile), expected)
      await rejectsArchive(() => executeRestore(contextFor(target, targetData), hostile), expected)
    }
    assert.equal(existsSync(sentinel), false, "no shell command ran")
    await assert.rejects(() => target.pool.query("SELECT 1 FROM schema_migrations"), /does not exist/u)
    assert.equal((await executeRestore(contextFor(target, targetData), archive)).failed, 0, "the real backup restores")
  } finally {
    await source.close()
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})
