import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import type { Pool } from "pg"

import { issueInvoice, seed, serve } from "../http/plugins-http.test-support.ts"
import { doctorReport } from "../ops/cli-doctor.ts"
import { dumpDatabase } from "../ops/postgres-backup-dump.ts"
import { assertSinglePublicSchema } from "../ops/postgres-backup-guards.ts"
import { allPlugins } from "../plugins.ts"
import type { SchemaMigration } from "./postgres-foundation.ts"
import { migrationScopes } from "./postgres-migration-plans.ts"
import { applyMigrations, ledgerTable } from "./postgres-migrations.ts"
import { createQueryPool, type PostgresSettings } from "./postgres-pool.ts"
import { createTestDatabase, testSettings, type TestFixture, withEmpty } from "./postgres-rig.test-support.ts"
import { resetFingerprintCache, schemaDrift } from "./postgres-schema-fingerprint.ts"

/**
 * deploy/postgres/grants.sql, the very file db-init runs, in the order production runs it:
 * on an empty database, before `migrate` creates the schema as qwbe_owner. qwbe_app's
 * rights then come from the default privileges alone. As qwbe_app the application runs
 * (readiness with its drift replay, the session, an issued invoice) and everything that
 * would switch off the fiscal guards or reach the server is refused. Last, restore.sh's
 * order: a new database, grants.sql, the dump loaded as qwbe_owner, then `migrate` with a
 * migration the dump does not have (an archive older than the image).
 */
const grants = readFileSync(new URL("../../deploy/postgres/grants.sql", import.meta.url), "utf8")

type Role = "qwbe_owner" | "qwbe_app"
interface Login { readonly role: Role; readonly user: string; readonly password: string }

/**
 * A LOGIN member of each role, named after the test database, dropped at the end whatever happens.
 * Each logs in already acting as its role (`SET role` on the login), so what it creates is the role's.
 */
const withLogins = async (fixture: TestFixture, use: (owner: Login, app: Login) => Promise<void>): Promise<void> => {
  const [owner, app] = (["qwbe_owner", "qwbe_app"] as const).map((role) =>
    ({ role, user: `${fixture.database}_${role.slice(5)}`, password: randomBytes(24).toString("hex") }))
  if (owner === undefined || app === undefined) throw new Error("two logins")
  const created: Array<string> = []
  try {
    for (const { role, user, password } of [owner, app]) {
      await fixture.sql.exec(`CREATE ROLE ${user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT PASSWORD '${password}' IN ROLE ${role}`)
      created.push(user)
      await fixture.sql.exec(`ALTER ROLE ${user} SET role = ${role}`)
    }
    await use(owner, app)
  } finally {
    for (const user of created) await fixture.sql.exec(`DROP ROLE ${user}`)
  }
}

const actingAs = (login: Login, database: string): { readonly settings: PostgresSettings; readonly pool: Pool } => {
  const settings = { ...testSettings(database), user: login.user, password: login.password }
  return { settings, pool: createQueryPool(settings) }
}

const scalar = async (pool: Pool, text: string): Promise<unknown> =>
  Object.values((await pool.query(text)).rows[0] as Record<string, unknown>)[0]

const owners = `SELECT string_agg(DISTINCT pg_get_userbyid(c.relowner), ',') FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`
const withoutAppRights = `SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND ((c.relkind = 'r' AND NOT (has_table_privilege('qwbe_app', c.oid, 'SELECT')
    AND has_table_privilege('qwbe_app', c.oid, 'INSERT') AND has_table_privilege('qwbe_app', c.oid, 'UPDATE')
    AND has_table_privilege('qwbe_app', c.oid, 'DELETE')))
  OR (c.relkind = 'S' AND NOT has_sequence_privilege('qwbe_app', c.oid, 'USAGE')))`

const sqlState = async (pool: Pool, statement: string): Promise<string> => {
  try {
    await pool.query(statement)
  } catch (error) {
    return String((error as { readonly code?: unknown }).code)
  }
  return "accepted"
}

const migrateAsOwner = async (owner: Login, database: string): Promise<void> => {
  const { pool } = actingAs(owner, database)
  try {
    const report = await applyMigrations(pool)
    assert.deepEqual(report.pending, [])
    assert.ok(report.changed > 0)
    // The owner's ceiling: its own database, nothing beyond it.
    for (const statement of [
      "COPY (SELECT 1) TO PROGRAM 'id'",
      "SELECT pg_read_file('/etc/passwd')",
      "ALTER SYSTEM SET log_statement = 'all'",
      `CREATE ROLE ${database}_intruder`,
      `CREATE DATABASE ${database}_intruder`,
      "GRANT qwbe_owner TO qwbe_app",
    ]) assert.equal(await sqlState(pool, statement), "42501", statement)
  } finally {
    await pool.end()
  }
}

/**
 * A migration newer than the dump: a table, a sequence and a function. It is appended to
 * the catalog scope for this process only (`node --test` runs each file in its own), as
 * kernel/storage/migration-upgrade.test.ts does; the shipped migrations are untouched.
 */
const newer: SchemaMigration = {
  name: "catalog-002-test-roles",
  statements: [
    "CREATE SEQUENCE roles_test_numbers",
    "CREATE TABLE roles_test_notes(id BIGINT PRIMARY KEY DEFAULT nextval('roles_test_numbers'), body TEXT NOT NULL)",
    "CREATE FUNCTION roles_test_count() RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT count(*) FROM roles_test_notes); END $$",
  ],
}

/**
 * restore.sh's `migrate` after the load: qwbe_owner applies the newer migration, with no
 * GRANT after it, and qwbe_app gets DML on the new table, the sequence and the function
 * from the default privileges alone, and no DDL on them.
 */
const migrateRestored = async (target: string, owner: Login, app: Login): Promise<void> => {
  const scope = migrationScopes.find(({ scope: name }) => name === "catalog")
  assert.ok(scope !== undefined, "the catalog scope exists")
  const catalog = scope.migrations as Array<SchemaMigration>
  catalog.push(newer)
  resetFingerprintCache()
  const asOwner = actingAs(owner, target).pool
  const asApp = actingAs(app, target).pool
  try {
    assert.deepEqual(await schemaDrift(asOwner), [], "the restored history explains the schema")
    assert.equal((await applyMigrations(asOwner)).changed, 1)
    assert.deepEqual(await schemaDrift(asOwner), [])
    assert.equal(await scalar(asOwner, `SELECT count(*)::int FROM ${ledgerTable} WHERE name = '${newer.name}'`), 1)
    assert.equal(await scalar(asApp, owners), "qwbe_owner")
    assert.equal(await scalar(asApp, withoutAppRights), 0, "the migrated objects carry qwbe_app's rights")
    assert.equal(await scalar(asApp, "SELECT has_function_privilege('qwbe_app', 'roles_test_count()', 'EXECUTE')"), true)
    await asApp.query("INSERT INTO roles_test_notes(body) VALUES ('after the restore')")
    assert.equal(await scalar(asApp, "SELECT roles_test_count()"), "1")
    for (const statement of [
      "ALTER TABLE roles_test_notes ADD COLUMN intruder integer",
      "ALTER SEQUENCE roles_test_numbers RESTART",
      "DROP FUNCTION roles_test_count()",
    ]) assert.equal(await sqlState(asApp, statement), "42501", statement)
  } finally {
    catalog.pop()
    resetFingerprintCache()
    await asOwner.end()
    await asApp.end()
  }
}

/** restore.sh's order: a new database, grants.sql, the dump loaded as qwbe_owner, then `migrate`. */
const restoreAsOwner = async (dump: string, owner: Login, app: Login, invoiceId: string): Promise<void> => {
  const target = await createTestDatabase("pg_roles_target")
  const superuser = createQueryPool(testSettings(target))
  try {
    await superuser.query(grants)
  } finally {
    await superuser.end()
  }
  const { host, port } = testSettings(target)
  const loaded = spawnSync("psql", ["--no-psqlrc", "--quiet", "--single-transaction", "--set=ON_ERROR_STOP=1",
    `--host=${host}`, `--port=${String(port)}`, `--username=${owner.user}`, `--dbname=${target}`,
    `--file=${dump}`], { encoding: "utf8", env: { ...process.env, PGPASSWORD: owner.password } })
  assert.equal(loaded.status, 0, loaded.stderr)
  const { pool } = actingAs(app, target)
  try {
    assert.equal(await scalar(pool, owners), "qwbe_owner")
    assert.equal(await scalar(pool, withoutAppRights), 0, "the restored objects carry qwbe_app's rights")
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM issued_invoices"), 1)
    await assert.rejects(pool.query("UPDATE issued_invoices SET series = series WHERE id = $1", [invoiceId]), /immutable/u)
  } finally {
    await pool.end()
  }
  await migrateRestored(target, owner, app)
}

/** The application as qwbe_app, the backup it reads, and what CREATE on the database still leaves it. Answers the invoice it issued. */
const runAsApplication = async (fixture: TestFixture, app: Login, dump: string): Promise<string> => {
  const { settings, pool } = actingAs(app, fixture.database)
  const application: TestFixture = { ...fixture, settings, pool,
    config: (overrides = {}) => fixture.config({ pgSettings: settings, ...overrides }) }
  try {
    // Readiness answers 200 only once the drift replay (CREATE SCHEMA scratch, ROLLBACK) passed as qwbe_app.
    const server = await serve(application, allPlugins)
    let invoiceId: string
    try {
      await seed(server)
      invoiceId = String((await issueInvoice(server.call, "roles-1")).id)
    } finally {
      await server.close()
    }

    for (const statement of [
      "ALTER TABLE issued_invoices DISABLE TRIGGER USER",
      "SET session_replication_role = replica",
      "COPY (SELECT 1) TO PROGRAM 'id'",
      "SELECT pg_read_file('/etc/passwd')",
      "ALTER SYSTEM SET log_statement = 'all'",
      "CREATE TABLE public.intruder (id integer)",
    ]) assert.equal(await sqlState(pool, statement), "42501", statement)
    await assert.rejects(pool.query("UPDATE issued_invoices SET series = series WHERE id = $1", [invoiceId]), /immutable/u)

    // The backup reads as qwbe_app, with the flags backup uses.
    await dumpDatabase(settings, dump, 60_000)

    // CREATE on the database still allows a schema of its own, outside `public`, and a
    // trusted extension, whose objects land in `public`. Neither passes unseen: doctor
    // lists both, the extension's functions are drift too, and backup refuses while the
    // schema exists.
    await pool.query("CREATE SCHEMA qwbe_intruder")
    await pool.query("CREATE EXTENSION pgcrypto")
    const report = await doctorReport(application.config(), pool)
    assert.deepEqual({ schemas: report.extraSchemas, extensions: report.extraExtensions },
      { schemas: ["qwbe_intruder"], extensions: ["pgcrypto"] })
    assert.ok(report.schemaDrift.includes("function:gen_random_bytes(integer)"), report.schemaDrift.join(", "))
    const client = await pool.connect()
    try {
      await assert.rejects(assertSinglePublicSchema(client), /also has qwbe_intruder/u)
    } finally {
      client.release()
    }
    return invoiceId
  } finally {
    await pool.end()
  }
}

void test("grants.sql, then migrate as qwbe_owner: qwbe_app runs the application on default privileges alone and cannot switch off the fiscal guards; a restored older schema migrates the same way",
  () => withEmpty("pg_roles", async (fixture) => {
    // Twice: db-init runs it before every migrate, so it has to converge.
    await fixture.sql.exec(grants)
    await fixture.sql.exec(grants)
    const roles = await fixture.sql.query(`SELECT rolname, rolsuper, rolinherit, rolcreatedb, rolcreaterole, rolcanlogin
      FROM pg_roles WHERE rolname IN ('qwbe_owner', 'qwbe_app') ORDER BY rolname`)
    assert.deepEqual(roles, ["qwbe_app", "qwbe_owner"].map((rolname) => ({ rolname, rolsuper: false, rolinherit: false,
      rolcreatedb: false, rolcreaterole: false, rolcanlogin: true })))
    assert.equal(await fixture.sql.scalar("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"),
      "qwbe_owner")

    await withLogins(fixture, async (owner, app) => {
      await migrateAsOwner(owner, fixture.database)
      assert.equal(await scalar(fixture.pool, owners), "qwbe_owner")
      assert.equal(await scalar(fixture.pool, withoutAppRights), 0, "no GRANT ran after the objects existed")

      const dump = join(fixture.dataDirectory, "database.sql")
      const invoiceId = await runAsApplication(fixture, app, dump)
      await restoreAsOwner(dump, owner, app, invoiceId)
    })
  }))
