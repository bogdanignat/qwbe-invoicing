import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { invoicingMigrations } from "../cube/invoicing/index.ts"
import { customersMigrations } from "../cube/invoicing/customers/index.ts"
import { paymentsMigrations } from "../cube/payments/index.ts"
import { handleApiRequest } from "./api.test-support.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { applyMigrations, databasePath, databaseReady, planMigrations, schemaDrift } from "./migrations.ts"

// Migration 020 as it was written before Article 310 moved from VAT category E
// to O. A database migrated back then keeps this CHECK forever, because the
// migration is recorded by name and the edited statement never runs again.
const legacyTaxConfigurations = "CREATE TABLE issuer_tax_configurations(organization_id TEXT NOT NULL,"
  + "code TEXT NOT NULL,category TEXT NOT NULL,rate TEXT NOT NULL,vat_exemption_reason TEXT,"
  + "effective_from TEXT NOT NULL,effective_to TEXT,PRIMARY KEY(organization_id,code,effective_from),"
  + "FOREIGN KEY(organization_id)REFERENCES issuers(organization_id)ON DELETE CASCADE,"
  + "CHECK((code='RO_STANDARD' AND rate IN('19.00','21.00') AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_REDUCED' AND rate IN('9.00','11.00') AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_REDUCED_5' AND rate='5.00' AND category='S' AND vat_exemption_reason IS NULL)"
  + "OR(code='RO_NON_VAT' AND rate='0.00' AND category='E' AND vat_exemption_reason IS NOT NULL "
  + "AND vat_exemption_reason='Regim special de scutire conform art. 310 din Codul fiscal')))STRICT"

const tamper = (dataDirectory: string, statements: ReadonlyArray<string>): void => {
  const database = new DatabaseSync(databasePath(dataDirectory))
  try {
    database.exec("PRAGMA foreign_keys = OFF")
    for (const statement of statements) database.exec(statement)
  } finally {
    database.close()
  }
}

// A database stopped part-way through the contract: it holds a prefix of the
// order the migrator itself runs, every migration it records really ran, and
// the rest are pending. This is the ordinary upgrade a migrate completes, so it
// must never be mistaken for an edited migration. The order is read from the
// plan of an empty directory, so the fixture cannot drift from the runner.
const seedThrough = (dataDirectory: string, through: string): ReadonlyArray<string> => {
  const order = planMigrations(dataDirectory).pending.filter((name) => !name.includes("/"))
  assert.ok(order.includes(through), `${through} is not in the migration order`)
  const prefix = order.slice(0, order.indexOf(through) + 1)
  const statements = new Map([...customersMigrations, ...invoicingMigrations, ...paymentsMigrations].map((migration) => [migration.name, migration.statements]))
  const database = new DatabaseSync(databasePath(dataDirectory))
  try {
    database.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT")
    const record = database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
    for (const name of prefix) {
      for (const statement of statements.get(name) ?? []) database.exec(statement)
      record.run(name, "2026-01-01")
    }
  } finally {
    database.close()
  }
  return prefix
}

// Everything migrate could change: the schema objects and the recorded history.
const storedState = (dataDirectory: string): ReadonlyArray<string> => {
  const database = new DatabaseSync(databasePath(dataDirectory), { readOnly: true })
  try {
    return [
      ...database.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(),
      ...database.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name").all(),
    ].map((row) => JSON.stringify(row))
  } finally {
    database.close()
  }
}

const cli = (dataDirectory: string, command: ReadonlyArray<string>) => spawnSync(
  process.execPath,
  [join(process.cwd(), "bin", "qwbe-invoicing.ts"), ...command],
  { encoding: "utf8", env: { ...process.env, DATA_DIR: dataDirectory, NODE_ENV: "development" } },
)

const reportOf = (stdout: string): { readonly schemaDrift: unknown } => JSON.parse(stdout) as { readonly schemaDrift: unknown }

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

const apiRuntime = (dataDirectory: string, tokenFile: string) => ({
  authenticate: createRequestAuthenticator({
    host: "127.0.0.1", port: 3000, dataDirectory, nodeEnvironment: "test",
    authTokenFile: tokenFile, organizationId: "org-1",
  }),
  dataDirectory,
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

void test("a freshly migrated database matches the migration contract", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  try {
    applyMigrations(directory)
    assert.deepEqual(schemaDrift(directory), [])
    assert.equal(databaseReady(directory), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("a database part-way through the contract is pending, not drifted", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  try {
    assert.deepEqual(seedThrough(directory, "invoicing-001-baseline"),
      ["000-foundation", "customers-001-baseline", "invoicing-001-baseline"])
    assert.deepEqual(schemaDrift(directory), [])
    assert.ok(planMigrations(directory).pending.includes("payments-001-baseline"))
    const plan = cli(directory, ["migrate", "--json"])
    assert.equal(plan.status, 0, plan.stderr)
    assert.deepEqual(reportOf(plan.stdout).schemaDrift, [])
    const apply = cli(directory, ["migrate", "--apply", "--json"])
    assert.equal(apply.status, 0, apply.stderr)
    assert.deepEqual(reportOf(apply.stdout).schemaDrift, [])
    assert.deepEqual(planMigrations(directory).pending, [])
    assert.equal(databaseReady(directory), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("an edited migration is reported as drift, refused by migrate and never ready", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  try {
    applyMigrations(directory)
    tamper(directory, ["DROP TABLE issuer_tax_configurations", legacyTaxConfigurations])
    assert.deepEqual(schemaDrift(directory), ["issuer_tax_configurations"])
    assert.equal(databaseReady(directory), false)
    const migrate = cli(directory, ["migrate", "--apply", "--json"])
    assert.equal(migrate.status, 1, migrate.stderr)
    assert.match(migrate.stderr, /issuer_tax_configurations.*recreate the database/)
    assert.deepEqual(reportOf(migrate.stdout).schemaDrift, ["issuer_tax_configurations"])
    const doctor = cli(directory, ["doctor", "--json"])
    assert.equal(doctor.status, 1, doctor.stderr)
    assert.deepEqual(reportOf(doctor.stdout).schemaDrift, ["issuer_tax_configurations"])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// History the contract no longer names (a baseline reset, or a baseline renamed
// after it ran) describes tables no pending migration can create again, so
// migrate refuses before it writes anything, in dry-run and in apply alike.
void test("history the contract does not recognise is refused before any migration runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  try {
    applyMigrations(directory)
    tamper(directory, ["UPDATE schema_migrations SET name = '001-core' WHERE name = 'invoicing-001-baseline'"])
    const before = storedState(directory)
    assert.ok(schemaDrift(directory).length > 0)
    for (const command of [["migrate", "--json"], ["migrate", "--apply", "--json"]]) {
      const migrate = cli(directory, command)
      assert.equal(migrate.status, 1, migrate.stderr)
      assert.match(migrate.stderr, /recreate the database/)
      const report = JSON.parse(migrate.stdout) as { readonly changed: number; readonly schemaDrift: ReadonlyArray<string> }
      assert.equal(report.changed, 0)
      assert.ok(report.schemaDrift.length > 0)
      assert.deepEqual(storedState(directory), before)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// The regression this guard exists for: on a drifted database, configuring a
// non-VAT issuer used to answer an unexplained 500 and log nothing at all.
void test("a write refused by a drifted schema answers internal_failure and logs the reason", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  const token = "a".repeat(64)
  const tokenFile = join(directory, "api-token")
  try {
    applyMigrations(directory)
    tamper(directory, ["DROP TABLE issuer_tax_configurations", legacyTaxConfigurations])
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const { value: response, logged } = await captureStderr(() => handleApiRequest({
      method: "PUT",
      url: "/api/issuer",
      authorization: `Bearer ${token}`,
      body: issuerBody({ registered: false, effectiveFrom: "2026-09-17", nonVatBasis: "article_310" }),
    }, apiRuntime(directory, tokenFile)))
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { error: "internal_failure" })
    assert.equal(logged.length, 1)
    const [event] = logged
    assert.ok(event !== undefined)
    assert.equal(event.event, "internal_failure")
    assert.equal(event.kind, "unmapped_failure")
    assert.match(String(event.reason), /DomainConflict persistence_conflict.*save issuer/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// A declared 500 answers with its own tag, which names no operation, so the
// store's reason has to reach stderr for that answer to be diagnosable too.
void test("a declared persistence failure keeps its tag and logs the failing operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-drift-"))
  const token = "b".repeat(64)
  const tokenFile = join(directory, "api-token")
  try {
    applyMigrations(directory)
    tamper(directory, ["DROP TABLE document_series"])
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const { value: response, logged } = await captureStderr(() => handleApiRequest({
      method: "GET",
      url: "/api/document-series",
      authorization: `Bearer ${token}`,
      body: undefined,
    }, apiRuntime(directory, tokenFile)))
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { error: "PersistenceFailure" })
    assert.equal(logged.length, 1)
    const [event] = logged
    assert.ok(event !== undefined)
    assert.equal(event.kind, "server_failure")
    assert.match(String(event.reason), /PersistenceFailure list document series/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
