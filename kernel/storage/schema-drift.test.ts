import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import type { Pool } from "pg"

import { handleApiRequest } from "../api/api.test-support.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { databaseReady, planMigrations, schemaDrift } from "./migrations.ts"
import { ledgerTable } from "./postgres-migrations.ts"
import { migrationScopes } from "./postgres-migration-plans.ts"
import { introspectSchema } from "./postgres-schema-introspection.ts"
import { resetFingerprintCache } from "./postgres-schema-fingerprint.ts"
import { withEmpty, withMigrated, type RawSql, type TestFixture } from "./postgres-rig.test-support.ts"

/**
 * Drift, on the real PostgreSQL catalogue. The answer is no longer a table name
 * out of `sqlite_master`: `introspectSchema` names tables, columns, constraints,
 * indexes, triggers and function bodies, so a drifted schema is reported as a
 * set of qualified object names. The assertions therefore say which tables the
 * drift belongs to, which is what the SQLite assertions meant, and leave the
 * exact object list to the comparison that produced it.
 *
 * `storedState` is the same idea, read from the same catalogue plus the ledger
 * and the issuer rows: the state a refused migration must not have touched.
 */

// The issuer baseline as it was written before Article 310 moved from VAT
// category E to O, in PostgreSQL and with an unnamed CHECK, which is a second
// reason the replay cannot match it. A database migrated back then keeps this
// definition forever, because the migration is recorded by name and the edited
// statement never runs again.
const legacyTaxConfigurations = "CREATE TABLE issuer_tax_configurations(organization_id TEXT NOT NULL,"
  + "code TEXT NOT NULL,category TEXT NOT NULL,rate TEXT NOT NULL,vat_exemption_reason TEXT,"
  + "effective_from TEXT NOT NULL,effective_to TEXT,PRIMARY KEY(organization_id,code,effective_from),"
  + "FOREIGN KEY(organization_id)REFERENCES issuers(organization_id)ON DELETE CASCADE,"
  + "CHECK((code='RO_STANDARD' AND rate IN('19.00','21.00') AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_REDUCED' AND rate IN('9.00','11.00') AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_REDUCED_5' AND rate='5.00' AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_NON_VAT' AND rate='0.00' AND category='E' AND vat_exemption_reason IS NOT NULL "
  + "AND vat_exemption_reason='Regim special de scutire conform art. 310 din Codul fiscal')))"

/**
 * An offline edit of the stored schema, with every trigger and foreign key of
 * the session suspended — the counterpart of `PRAGMA foreign_keys = OFF`.
 */
const tamper = (sql: RawSql, statements: ReadonlyArray<string>): Promise<void> =>
  sql.withoutTriggers(async (scoped) => {
    for (const statement of statements) await scoped.exec(statement)
  })

/** The tables a drift report is about, which is what the SQLite names were. */
const driftedTables = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(names.map((name) => name.replace(/^[a-z]+:/u, "").split(".")[0] ?? name))].sort()

/**
 * The ledger as the executor creates it. Written out here because a partially
 * migrated database cannot be produced by the executor itself — it applies
 * everything — and the compatibility of this shape with the real one is proved
 * in the same test, by letting `migrate --apply` finish the job on it.
 */
const ledgerDefinition = `CREATE TABLE ${ledgerTable}(
  scope TEXT NOT NULL, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (scope, name))`

/**
 * A database stopped part-way through the contract: it holds a prefix of the
 * order the migrator itself runs, every migration it records really ran, and
 * the rest are pending. This is the ordinary upgrade a migrate completes, so it
 * must never be mistaken for an edited migration. The order is read from the
 * plan of the empty database, so the fixture cannot drift from the runner.
 */
const seedThrough = async (
  fixture: TestFixture,
  through: `${string}/${string}`,
): Promise<ReadonlyArray<string>> => {
  const order = (await planMigrations(fixture.pool)).pending
  assert.ok(order.includes(through), `${through} is not in the migration order`)
  const prefix = order.slice(0, order.indexOf(through) + 1)
  const statements = new Map<string, { readonly scope: string; readonly name: string; readonly body: ReadonlyArray<string> }>(
    migrationScopes.flatMap(({ scope, migrations }) =>
      migrations.map(({ name, statements: body }) => [`${scope}/${name}`, { scope, name, body }] as const)))
  await fixture.sql.exec(ledgerDefinition)
  for (const key of prefix) {
    const migration = statements.get(key)
    assert.ok(migration, key)
    for (const statement of migration.body) await fixture.sql.exec(statement)
    await fixture.sql.query(
      `INSERT INTO ${ledgerTable}(scope, name, applied_at) VALUES ($1, $2, '2026-01-01T00:00:00Z')`,
      [migration.scope, migration.name],
    )
  }
  return prefix
}

// Everything migrate could change here: schema objects, recorded history and
// representative issuer data that must survive a refused migration untouched.
const storedState = async (pool: Pool, sql: RawSql): Promise<ReadonlyArray<string>> => [
  ...await introspectSchema(pool, "public"),
  ...await sql.query(`SELECT scope, name, applied_at FROM ${ledgerTable} ORDER BY scope, name`),
  ...await sql.query("SELECT * FROM issuers ORDER BY organization_id"),
  ...await sql.query("SELECT * FROM issuer_tax_configurations ORDER BY organization_id, code, effective_from"),
].map((row) => JSON.stringify(row))

const cli = (fixture: TestFixture, command: ReadonlyArray<string>) => spawnSync(
  process.execPath,
  [join(process.cwd(), "bin", "qwbe-invoicing.ts"), ...command],
  { encoding: "utf8", env: fixture.childEnv() },
)

const reportOf = (stdout: string): { readonly schemaDrift: ReadonlyArray<string> } =>
  JSON.parse(stdout) as { readonly schemaDrift: ReadonlyArray<string> }

// Every 500 has to leave exactly one line behind, so the assertions are about
// what stderr received while the request ran, not about what it looked like.
const captureStderr = async <Value>(run: () => Promise<Value>): Promise<{
  readonly value: Value
  readonly logged: ReadonlyArray<Record<string, unknown>>
}> => {
  const write = process.stderr.write.bind(process.stderr)
  const chunks: Array<string> = []
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return true
  }
  const value = await (async () => {
    try {
      return await run()
    } finally {
      process.stderr.write = write
    }
  })()
  const text = chunks.join("").trim()
  const logged = text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  return { value, logged }
}

const apiRuntime = (fixture: TestFixture, tokenFile: string) => ({
  authenticate: createRequestAuthenticator(fixture.config({ authTokenFile: tokenFile })),
  pool: fixture.pool,
  dataDirectory: fixture.dataDirectory,
  now: () => new Date("2026-09-17T10:00:00.000Z"),
})

const issuerBody = (vatChange: unknown) => ({
  name: "Exemplu SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
  legalForm: "srl",
  tradeRegistryNumber: "J22/123/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Română",
  socialCapital: "1000",
  defaultCurrency: "RON",
  defaultPaymentTermDays: 15,
  vatChange,
  branding: null,
})

void test("a freshly migrated database matches the migration contract", async () => {
  await withMigrated("drift_fresh", async ({ pool }) => {
    assert.deepEqual(await schemaDrift(pool), [])
    assert.equal(await databaseReady(pool), true)
  })
})

void test("a database part-way through the contract is pending, not drifted", async () => {
  await withEmpty("drift_partial", async (fixture) => {
    assert.deepEqual(await seedThrough(fixture, "invoicing/invoicing-001-baseline"), [
      "foundation/000-foundation", "customers/customers-001-baseline", "catalog/catalog-001-baseline",
      "issuer/issuer-001-baseline", "invoicing/invoicing-001-baseline",
    ])
    assert.deepEqual(await schemaDrift(fixture.pool), [])
    assert.ok((await planMigrations(fixture.pool)).pending.includes("payments/payments-001-baseline"))
    const plan = cli(fixture, ["migrate", "--json"])
    assert.equal(plan.status, 0, plan.stderr)
    assert.deepEqual(reportOf(plan.stdout).schemaDrift, [])
    const apply = cli(fixture, ["migrate", "--apply", "--json"])
    assert.equal(apply.status, 0, apply.stderr)
    assert.deepEqual(reportOf(apply.stdout).schemaDrift, [])
    assert.deepEqual((await planMigrations(fixture.pool)).pending, [])
    assert.equal(await databaseReady(fixture.pool), true)
  })
})

/**
 * A database with the complete physical schema whose ledger does not record the
 * baseline that owns part of it: the unrecorded owner must be reported as
 * drift, never applied over the existing tables, and both CLI modes must leave
 * all state untouched.
 *
 * The unrecorded baseline is the last one in the order, and that is the ported
 * part of this case. PostgreSQL replays the whole recorded history into a
 * scratch schema, in order, with real foreign keys, so an unrecorded *earlier*
 * baseline is not drift at all: the replay of the later migrations fails
 * outright because their parent tables were never created. SQLite could leave
 * the gap anywhere because its replay was only a prefix of text.
 */
void test("a baseline the ledger does not record is refused without changing state", async () => {
  await withEmpty("drift_owner", async (fixture) => {
    const { sql, pool } = fixture
    await sql.exec(ledgerDefinition)
    for (const { scope, migrations } of migrationScopes) {
      for (const migration of migrations) {
        for (const statement of migration.statements) await sql.exec(statement)
        if (migration.name === "documents-001-baseline") continue
        await sql.query(
          `INSERT INTO ${ledgerTable}(scope, name, applied_at) VALUES ($1, $2, '2026-01-01T00:00:00Z')`,
          [scope, migration.name],
        )
      }
    }
    await sql.exec(`
      INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,default_currency,
        default_payment_term_days,legal_form,trade_registry_number,iban,bank_name,social_capital)
        VALUES('org-legacy','Exemplu SRL','12345674','RO','Botoșani','Strada Mare 1','RO-BT','RON',15,
          'srl','J07/1/2020','RO49AAAA1B31007593840000','Banca Română','1000.00');
      INSERT INTO issuer_tax_configurations(organization_id,code,category,rate,effective_from)
        VALUES('org-legacy','RO_STANDARD','S','21.00','2026-01-01');
    `)
    const drift = await schemaDrift(pool)
    assert.deepEqual(driftedTables(drift), ["invoice_artifacts", "proforma_artifacts"])
    assert.equal(await databaseReady(pool), false)
    const before = await storedState(pool, sql)
    for (const command of [["migrate", "--json"], ["migrate", "--apply", "--json"]]) {
      const migrate = cli(fixture, command)
      assert.equal(migrate.status, 1, migrate.stderr)
      assert.match(migrate.stderr, /invoice_artifacts.*proforma_artifacts.*recreate the database/s)
      const report = JSON.parse(migrate.stdout) as { readonly changed: number; readonly schemaDrift: ReadonlyArray<string> }
      assert.equal(report.changed, 0)
      assert.deepEqual(driftedTables(report.schemaDrift), ["invoice_artifacts", "proforma_artifacts"])
      assert.deepEqual(await storedState(pool, sql), before)
    }
  })
})

void test("an edited migration is reported as drift, refused by migrate and never ready", async () => {
  await withMigrated("drift_edited", async (fixture) => {
    const { sql, pool } = fixture
    await tamper(sql, [`DROP TABLE issuer_tax_configurations`, legacyTaxConfigurations])
    resetFingerprintCache()
    assert.deepEqual(driftedTables(await schemaDrift(pool)), ["issuer_tax_configurations"])
    assert.equal(await databaseReady(pool), false)
    const migrate = cli(fixture, ["migrate", "--apply", "--json"])
    assert.equal(migrate.status, 1, migrate.stderr)
    assert.match(migrate.stderr, /issuer_tax_configurations.*recreate the database/s)
    assert.deepEqual(driftedTables(reportOf(migrate.stdout).schemaDrift), ["issuer_tax_configurations"])
    const doctor = cli(fixture, ["doctor", "--json"])
    assert.equal(doctor.status, 1, doctor.stderr)
    assert.deepEqual(driftedTables(reportOf(doctor.stdout).schemaDrift), ["issuer_tax_configurations"])
  })
})

// History the contract no longer names (a baseline reset, or a baseline renamed
// after it ran) describes tables no pending migration can create again, so
// migrate refuses before it writes anything, in dry-run and in apply alike. The
// renamed baseline is the last in the order for the same reason as above: an
// unrecognised earlier one leaves the replay of the rest without its parents.
void test("history the contract does not recognise is refused before any migration runs", async () => {
  await withMigrated("drift_history", async (fixture) => {
    const { sql, pool } = fixture
    await sql.query(`UPDATE ${ledgerTable} SET name = '001-core' WHERE name = 'documents-001-baseline'`)
    resetFingerprintCache()
    const before = await storedState(pool, sql)
    assert.ok((await schemaDrift(pool)).length > 0)
    for (const command of [["migrate", "--json"], ["migrate", "--apply", "--json"]]) {
      const migrate = cli(fixture, command)
      assert.equal(migrate.status, 1, migrate.stderr)
      assert.match(migrate.stderr, /recreate the database/)
      const report = JSON.parse(migrate.stdout) as { readonly changed: number; readonly schemaDrift: ReadonlyArray<string> }
      assert.equal(report.changed, 0)
      assert.ok(report.schemaDrift.length > 0)
      assert.deepEqual(await storedState(pool, sql), before)
    }
  })
})

// The regression this guard exists for: on a drifted database, configuring a
// non-VAT issuer used to answer an unexplained 500 and log nothing at all.
void test("a write refused by a drifted schema answers internal_failure and logs the reason", async () => {
  await withMigrated("drift_write", async (fixture) => {
    const token = "a".repeat(64)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    await tamper(fixture.sql, [`DROP TABLE issuer_tax_configurations`, legacyTaxConfigurations])
    resetFingerprintCache()
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const { value: response, logged } = await captureStderr(() => handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization: `Bearer ${token}`,
      body: issuerBody({ registered: false, effectiveFrom: "2026-09-17", nonVatBasis: "article_310" }),
    }, apiRuntime(fixture, tokenFile)))
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { error: "internal_failure" })
    assert.equal(logged.length, 1)
    const [event] = logged
    assert.ok(event !== undefined)
    assert.equal(event.event, "internal_failure")
    assert.equal(event.kind, "unmapped_failure")
    assert.match(String(event.reason), /DomainConflict persistence_conflict.*save issuer/)
  })
})

// A declared 500 answers with its own tag, which names no operation, so the
// store's reason has to reach stderr for that answer to be diagnosable too.
void test("a declared persistence failure keeps its tag and logs the failing operation", async () => {
  await withMigrated("drift_declared", async (fixture) => {
    const token = "b".repeat(64)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    await tamper(fixture.sql, [`DROP TABLE document_series CASCADE`])
    resetFingerprintCache()
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const { value: response, logged } = await captureStderr(() => handleApiRequest({
      method: "GET",
      url: "/api/document-series",
      authorization: `Bearer ${token}`,
      body: undefined,
    }, apiRuntime(fixture, tokenFile)))
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { error: "PersistenceFailure" })
    assert.equal(logged.length, 1)
    const [event] = logged
    assert.ok(event !== undefined)
    assert.equal(event.kind, "server_failure")
    assert.match(String(event.reason), /PersistenceFailure list document series/)
  })
})
