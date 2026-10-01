import assert from "node:assert/strict"
import { chmodSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { parseCommand } from "./cli.ts"
import { route } from "../http/http.ts"
import { applyMigrations, artifactsDirectoryReady, databaseReady, planMigrations } from "../storage/migrations.ts"
import { withEmpty, withMigrated, type RawSql, type TestFixture } from "../storage/postgres-rig.test-support.ts"
import { staticUiResponse } from "../http/static-ui.ts"

/**
 * The host's operational surface on PostgreSQL.
 *
 * Two premises are gone with SQLite and were replaced rather than dropped:
 *
 * - `PRAGMA journal_mode = wal` has no counterpart. Durability is a cluster
 *   setting now, not something a migration can leave behind, so that test keeps
 *   the half that is still the migrations' job — the triggers, the typed columns
 *   and the named CHECKs — read from the catalogue.
 * - `migrate` no longer touches `DATA_DIR`, so an unusable data directory can no
 *   longer be the CLI's execution failure. The failure mode that exists now is a
 *   database that cannot be reached, which is what that case uses.
 */

const sourceIndexColumns = async (sql: RawSql, index: string): Promise<ReadonlyArray<string>> =>
  (await sql.query<{ readonly attname: string }>(
    `SELECT a.attname FROM pg_index x
     JOIN pg_class i ON i.oid = x.indexrelid
     JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = ANY(x.indkey)
     JOIN unnest(x.indkey) WITH ORDINALITY AS k(attnum, position) ON k.attnum = a.attnum
     WHERE i.relname = $1 ORDER BY k.position`,
    [index],
  )).map(({ attname }) => attname)

const assertSourceIndexes = async (sql: RawSql): Promise<void> => {
  for (const [table, index] of [["issued_invoices", "issued_invoices_source"], ["proformas", "proformas_source"]] as const) {
    assert.equal(await sql.scalar(
      `SELECT tablename FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index],
    ), table, `${index} must belong to ${table}`)
    assert.deepEqual(await sourceIndexColumns(sql, index),
      ["organization_id", "source_app", "source_kind", "source_id"], index)
  }
}

const cli = (fixture: TestFixture, args: ReadonlyArray<string>, overrides: Readonly<Record<string, string>> = {}) =>
  spawnSync(process.execPath, [join(process.cwd(), "bin", "qwbe-invoicing.ts"), ...args],
    { encoding: "utf8", env: fixture.childEnv(overrides) })

void test("migration apply is idempotent", async () => {
  await withEmpty("ops_idempotent", async ({ pool, sql }) => {
    // One database, one ledger: the keys are `scope/name`, in application order.
    assert.deepEqual((await planMigrations(pool)).pending, [
      "foundation/000-foundation",
      "customers/customers-001-baseline",
      "catalog/catalog-001-baseline",
      "issuer/issuer-001-baseline",
      "invoicing/invoicing-001-baseline",
      "payments/payments-001-baseline",
      "documents/documents-001-baseline",
      "standalone/000-browser-sessions",
    ])
    assert.equal((await applyMigrations(pool)).changed, 8)
    await assertSourceIndexes(sql)
    assert.equal((await applyMigrations(pool)).changed, 0)
    await assertSourceIndexes(sql)
    assert.equal(await databaseReady(pool), true)
  })
})

void test("migrate CLI reapplies the complete schema with zero changes", async () => {
  await withEmpty("ops_migrate_cli", (fixture) => {
    const first = cli(fixture, ["migrate", "--apply", "--json"])
    assert.equal(first.status, 0, first.stderr)
    const firstReport: unknown = JSON.parse(first.stdout)
    assert.ok(typeof firstReport === "object" && firstReport !== null && "changed" in firstReport)
    assert.equal(firstReport.changed, 8)
    const second = cli(fixture, ["migrate", "--apply", "--json"])
    assert.equal(second.status, 0, second.stderr)
    const secondReport: unknown = JSON.parse(second.stdout)
    assert.deepEqual(secondReport, { scanned: 8, changed: 0, skipped: 8, failed: 0, pending: [], schemaDrift: [] })
    return Promise.resolve()
  })
})

void test("migrations leave the immutability triggers, typed columns and named checks in place", async () => {
  await withMigrated("ops_schema", async ({ sql }) => {
    const triggers = new Set((await sql.query<{ readonly tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal",
    )).map(({ tgname }) => tgname))
    for (const expected of ["issued_invoices_no_update", "issued_invoices_no_delete", "issued_lines_no_update", "issued_lines_no_delete",
      "issued_tax_breakdown_no_update", "issued_tax_breakdown_no_delete", "correction_documents_no_update", "correction_documents_no_delete",
      "proformas_no_delete", "proformas_no_content_update", "idempotency_records_no_update", "idempotency_records_no_delete",
      "issued_invoices_actor_no_update", "proformas_actor_no_update", "correction_documents_actor_no_update",
      "audit_events_no_update", "audit_events_no_delete"]) {
      assert.ok(triggers.has(expected), `${expected} must exist after all migrations`)
    }
    const column = (table: string, name: string) => sql.one(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, name],
    )
    const checks = async (table: string) => (await sql.query<{ readonly conname: string; readonly definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE contype = 'c' AND conrelid = $1::regclass`, [table],
    ))
    for (const table of ["issued_invoices", "proformas", "correction_documents"]) {
      assert.deepEqual(await column(table, "actor_id"),
        { data_type: "text", is_nullable: "NO", column_default: null }, table)
      assert.deepEqual(await column(table, "issuer_vat_registered"),
        { data_type: "integer", is_nullable: "NO", column_default: null }, table)
      // The flag is a named CHECK now, so the guarantee is read by name.
      const flag = (await checks(table)).find(({ conname }) => conname.endsWith("issuer_vat_registered_flag"))
      assert.ok(flag, `${table} issuer_vat_registered CHECK`)
      assert.match(flag.definition, /issuer_vat_registered = ANY \(ARRAY\[0, 1\]\)/u, table)
    }
    // What `STRICT` stood for on `audit_events`: every column is typed, and the
    // engine enforces it unconditionally.
    assert.deepEqual(await sql.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_events' AND data_type NOT IN ('text','integer','bigint')`,
    ), [])
    assert.equal((await sql.rejects(
      "INSERT INTO invoice_sequences(organization_id,fiscal_year,document_type,series,last_number)"
      + " VALUES('org-typed','not-a-year','invoice','INV',1)",
    )).code, "22P02")
    for (const [table, brandingColumn] of [["issuers", "branding"], ["issued_invoices", "issuer_branding"], ["proformas", "issuer_branding"]] as const) {
      assert.ok(await column(table, brandingColumn), `${table}.${brandingColumn}`)
    }
    for (const table of ["issuers", "issued_invoices", "proformas", "correction_documents"]) {
      const prefix = table === "issuers" ? "" : "issuer_"
      for (const name of ["legal_form", "trade_registry_number", "iban", "bank_name", "social_capital"]) {
        assert.ok(await column(table, `${prefix}${name}`), `${table}.${prefix}${name}`)
      }
      const legalForm = (await checks(table)).find(({ conname }) => conname.endsWith("legal_form_valid"))
      assert.ok(legalForm, `${table} legal_form CHECK`)
      assert.match(legalForm.definition, /legal_form = ANY \(ARRAY\['srl'::text, 'pfa'::text\]\)/u, table)
    }
    // `UPDATE OF <column>` is in the trigger definition, where the SQLite
    // trigger body used to name the columns it protected.
    for (const trigger of ["issued_invoices_no_update", "proformas_no_content_update"]) {
      const definition = String(await sql.scalar(
        "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = $1", [trigger],
      ))
      for (const name of ["issuer_branding", "issuer_legal_form", "issuer_vat_registered"]) {
        assert.ok(definition.includes(name), `${trigger}.${name}`)
      }
    }
    assert.equal(await column("proformas", "invoice_series"), undefined)
    assert.ok(triggers.has("issued_invoices_lineage_insert"))
    await sql.exec(`INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,
      default_currency,default_payment_term_days,legal_form,trade_registry_number,iban,bank_name,social_capital)
      VALUES('org-idempotency','Furnizor SRL','12345674','RO','Iași','Strada 1','RO-IS','RON',15,'srl','J22/123/2020','','','1000.00')`)
    await sql.query(`INSERT INTO idempotency_records(
      organization_id,idempotency_key,operation,fingerprint,result_kind,result_id,created_at)
      VALUES('org-idempotency','draft-from-proforma','create_draft_invoice_from_proforma',$1,'draft','draft-1','2026-09-01T10:00:00.000Z')`,
      [`sha256:${"0".repeat(64)}`])
    assert.equal(await sql.scalar("SELECT result_kind FROM idempotency_records WHERE idempotency_key='draft-from-proforma'"), "draft")
  })
})

void test("readiness stays true while another connection holds a write lock", async () => {
  await withMigrated("ops_lock", async ({ pool, sql }) => {
    // The exclusive business lock plus an uncommitted write: what every writer
    // holds, and what `BEGIN IMMEDIATE` used to mean.
    await sql.transaction(async (writer) => {
      await writer.exec("SELECT pg_advisory_xact_lock(1480, 2)")
      await writer.exec(`INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,
        default_currency,default_payment_term_days,legal_form,trade_registry_number,iban,bank_name,social_capital)
        VALUES('org-writer','Furnizor SRL','12345674','RO','Iași','Strada 1','RO-IS','RON',15,'srl','J22/123/2020','','','1000.00')`)
      const started = performance.now()
      assert.equal(await databaseReady(pool), true)
      assert.ok(performance.now() - started < 1_000, "readiness must not wait on the writer")
    })
  })
})

void test("readiness fails when the schema is absent or the artifact directory loses write access", async () => {
  // The database half: a reachable database whose ledger describes nothing is
  // not ready, and no further migration is implied by this answer.
  await withEmpty("ops_unready", async ({ pool }) => {
    assert.equal(await databaseReady(pool), false)
  })
  // The filesystem half, which PostgreSQL did not take away: PDFs are still
  // content-addressed files under `DATA_DIR`.
  await withMigrated("ops_readonly", async ({ pool, dataDirectory }) => {
    assert.equal(await databaseReady(pool), true)
    assert.equal(artifactsDirectoryReady(dataDirectory), true)
    chmodSync(dataDirectory, 0o555)
    try {
      assert.equal(artifactsDirectoryReady(dataDirectory), false)
    } finally {
      chmodSync(dataDirectory, 0o755)
    }
  })
})

void test("migrate remains dry-run unless apply is explicit", () => {
  assert.deepEqual(parseCommand(["migrate", "--json"]), {
    name: "migrate",
    apply: false,
    confirmProduction: false,
    json: true,
  })
})

void test("artifact reconciliation is bounded and dry-run unless apply is explicit", () => {
  assert.deepEqual(parseCommand(["artifacts", "--limit", "25", "--json"]), {
    name: "artifacts",
    apply: false,
    confirmProduction: false,
    json: true,
    limit: 25,
  })
  assert.throws(() => parseCommand(["artifacts", "--limit", "101"]))
})

void test("CLI distinguishes invalid input, guard refusal, and execution failure", async () => {
  await withEmpty("ops_exit_codes", (fixture) => {
    const invalid = cli(fixture, ["unknown"])
    assert.equal(invalid.status, 2)

    const refused = cli(fixture, ["migrate", "--apply"], { NODE_ENV: "production" })
    assert.equal(refused.status, 2)

    // Execution failure, PostgreSQL flavoured: the target database does not
    // exist, so the command cannot connect. `DATA_DIR` is no longer involved —
    // `migrate` does not touch the filesystem.
    const failed = cli(fixture, ["migrate", "--apply"], { PGDATABASE: "t_absent_database" })
    assert.equal(failed.status, 1)
    return Promise.resolve()
  })
})

void test("readiness is observable over the HTTP contract", () => {
  assert.equal(route("GET", "/health/ready", false).status, 503)
  assert.equal(route("GET", "/health/ready", true).status, 200)
  assert.equal(route("POST", "/", true).status, 405)
})

void test("production Compose confirms the guarded migration apply", () => {
  const compose = readFileSync(join(process.cwd(), "compose.prod.yaml"), "utf8")
  assert.match(compose, /"migrate", "--apply", "--confirm-production", "--json"/)
})

void test("serves assets and clean UI routes only from an allowlist with restrictive headers", () => {
  assert.deepEqual(readdirSync(join(process.cwd(), "standalone/ui-dist")).sort(), ["assets", "index.html"])
  assert.deepEqual(readdirSync(join(process.cwd(), "standalone/ui-dist/assets")).sort(), ["app.css", "app.js"])
  const page = staticUiResponse("GET", "/app")
  assert.ok(page)
  assert.equal(page.status, 200)
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8")
  const contentSecurityPolicy = page.headers["content-security-policy"]
  assert.ok(contentSecurityPolicy)
  assert.match(contentSecurityPolicy, /default-src 'none'/)
  assert.match(Buffer.from(page.body).toString("utf8"), /QWBE Invoicing/)
  for (const path of ["/unlock", "/invoices", "/invoices/new", "/invoices/invoice-1", "/drafts/draft-1", "/proformas", "/proformas/proforma-1", "/customers", "/products", "/settings"]) {
    assert.equal(staticUiResponse("GET", path)?.headers["content-type"], "text/html; charset=utf-8")
  }
  assert.equal(staticUiResponse("GET", "/api/invoices"), undefined)
  assert.equal(staticUiResponse("GET", "/api/proformas"), undefined)
  assert.equal(staticUiResponse("GET", "/health/live"), undefined)
  assert.equal(staticUiResponse("GET", "/unknown"), undefined)

  const script = staticUiResponse("HEAD", "/assets/app.js")
  assert.ok(script)
  assert.equal(script.status, 200)
  assert.equal(script.body.length, 0)
  assert.equal(script.headers["x-content-type-options"], "nosniff")
  const scriptBody = staticUiResponse("GET", "/assets/app.js")
  assert.ok(scriptBody)
  assert.equal(scriptBody.body.length > 1_000, true)
  assert.equal(staticUiResponse("GET", "/assets/app.css")?.status, 200)
  assert.equal(staticUiResponse("GET", "/assets/api-client.js"), undefined)
  assert.equal(staticUiResponse("GET", "/assets/../api-token"), undefined)
  assert.equal(staticUiResponse("GET", "/assets/%2e%2e/api-token"), undefined)
  assert.equal(staticUiResponse("POST", "/assets/app.js")?.status, 405)
})
