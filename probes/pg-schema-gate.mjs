/**
 * Gate G1 and the PostgreSQL schema parity matrix.
 *
 * Runs only against a throwaway PostgreSQL 16 cluster (compose.pg-schema-gate.yaml);
 * it is not part of `pnpm test`, which still runs the SQLite suite. Every database
 * it uses it creates itself, from `template0` with the C collation, and drops in a
 * `finally`. No existing database, volume or port is touched.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { clearTimeout, setTimeout } from "node:timers"
import { URL } from "node:url"

import pg from "pg"


import { translatedPredicate, triggerDifferences } from "./pg-schema-trigger-parity-lib.mjs"
import { migrationScopes } from "../standalone/storage/postgres-migration-plans.ts"
import {
  applyMigrations, applyMigrationsOnClient, assertCollationC, databaseReady, planMigrations,
} from "../standalone/storage/postgres-migrations.ts"
import {
  acquireSharedMaintenanceLock, releaseSharedMaintenanceLock,
} from "../standalone/storage/postgres-maintenance-lock.ts"

const { Client, Pool } = pg

const connection = {
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER, database: process.env.PGDATABASE,
  connectionTimeoutMillis: 5000, statement_timeout: 30000,
}

const started = Date.now()
const results = []
const check = (name, body) => {
  try {
    body()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

const bounded = async (label, millis, work) => {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: exceeded ${millis}ms bound`)), millis)
  })
  try { return await Promise.race([work, guard]) } finally { clearTimeout(timer) }
}

const databases = []
const createDatabase = async (admin, name, locale = { collate: "C", ctype: "C" }) => {
  assert.match(name, /^gate_[a-z0-9_]+$/u, "database name")
  assert.match(`${locale.collate}${locale.ctype}`, /^[A-Za-z0-9._-]+$/u, "locale")
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 `
    + `LC_COLLATE '${locale.collate}' LC_CTYPE '${locale.ctype}' ENCODING 'UTF8'`)
  databases.push(name)
  return new Pool({ ...connection, database: name, max: 2 })
}

const INVENTORY = `
  SELECT 'table' AS kind, c.relname AS name, '' AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
  UNION ALL
  SELECT 'index', c.relname, pg_get_indexdef(c.oid)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    -- Only indexes that BACK a constraint are implicit. A foreign key's
    -- conindid points at the parent's unique index, which stays explicit.
    LEFT JOIN pg_constraint k ON k.conindid = c.oid AND k.contype IN ('p', 'u', 'x')
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND k.oid IS NULL
      AND c.relname NOT LIKE 'schema_migrations%'
  UNION ALL
  SELECT 'check', co.conname, pg_get_constraintdef(co.oid)
    FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
    WHERE n.nspname = 'public' AND co.contype = 'c'
  UNION ALL
  SELECT 'foreign-key', co.conname, pg_get_constraintdef(co.oid)
    FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace
    WHERE n.nspname = 'public' AND co.contype = 'f'
  UNION ALL
  SELECT 'trigger', t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function', p.proname, pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  ORDER BY 1, 2, 3`

const TRIGGER_ROWS = `
  SELECT t.tgname AS name, c.relname AS table_name,
         (t.tgtype::int & 1) = 1 AS for_each_row,
         (t.tgtype::int & 2) = 2 AS before,
         (t.tgtype::int & 4) = 4 AS on_insert,
         (t.tgtype::int & 8) = 8 AS on_delete,
         (t.tgtype::int & 16) = 16 AS on_update,
         COALESCE((SELECT array_agg(a.attname ORDER BY k.ord)
                     FROM unnest(t.tgattr) WITH ORDINALITY AS k(num, ord)
                     JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.num)::text[],
                  ARRAY[]::text[]) AS update_of,
         t.tgqual IS NOT NULL AS has_when,
         p.proname AS action_function, p.prosrc AS action_source,
         pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE n.nspname = 'public' AND NOT t.tgisinternal
   ORDER BY t.tgname`

const inventory = async (pool) => {
  const { rows } = await pool.query(INVENTORY)
  return rows.map(({ kind, name, definition }) => `${kind} ${name} ${definition}`)
}

const countOf = (objects, kind) => objects.filter((entry) => entry.startsWith(`${kind} `)).length

const failed = (error) => ({ code: error?.code, message: error?.message ?? String(error) })

/** Runs one statement in its own savepoint and reports how it ended. */
const attempt = async (client, sql) => {
  await client.query("SAVEPOINT probe")
  try {
    await client.query(sql)
    await client.query("ROLLBACK TO SAVEPOINT probe")
    return { ok: true }
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT probe")
    return { ok: false, ...failed(error) }
  }
}

const main = async () => {
  const admin = new Client(connection)
  await bounded("admin connect", 10000, admin.connect())
  const pools = []
  try {
    // ---------------------------------------------------------------- G1
    const first = await createDatabase(admin, "gate_g1_a")
    pools.push(first)
    const scanned = migrationScopes.reduce((total, scope) => total + scope.migrations.length, 0)

    const firstRun = await bounded("G1 apply #1", 120000, applyMigrations(first))
    check("G1 first apply changes every migration", () => {
      assert.deepEqual({ ...firstRun, pending: [...firstRun.pending] },
        { scanned, changed: scanned, skipped: 0, failed: 0, pending: [] })
    })

    // Captured BEFORE the reapply: comparing two post-reapply captures would
    // only prove that `inventory()` is deterministic.
    const inventoryAfterFirstApply = await inventory(first)

    const reapply = await bounded("G1 reapply", 60000, applyMigrations(first))
    const afterPlan = await planMigrations(first)
    check("G1 reapply on the same database changes nothing", () => {
      assert.equal(reapply.changed, 0)
      assert.deepEqual([...afterPlan.pending], [])
      assert.equal(afterPlan.skipped, scanned)
    })
    const ready = await databaseReady(first)
    check("databaseReady answers true once applied", () => { assert.equal(ready, true) })

    const inventoryA = await inventory(first)
    check("reapply leaves the schema byte-identical with the first apply", () => {
      assert.deepEqual(inventoryA, inventoryAfterFirstApply)
      assert.ok(inventoryAfterFirstApply.length > 0, "inventory is not empty")
    })

    const second = await createDatabase(admin, "gate_g1_b")
    pools.push(second)
    const secondRun = await bounded("G1 apply #2", 120000, applyMigrations(second))
    const inventoryB = await inventory(second)
    check("G1 second fresh database applies identically", () => {
      assert.equal(secondRun.changed, scanned)
      assert.deepEqual(inventoryB, inventoryA)
    })

    // -------------------------------------------------- inventory parity
    const golden = JSON.parse(readFileSync(new URL("../standalone/parity/sqlite-baseline-objects.json",
      import.meta.url), "utf8"))
    const goldenTables = golden.plans.flatMap((plan) => plan.tables.map(({ name }) => name)).sort()
    const goldenIndexes = golden.plans.flatMap((plan) => plan.explicitIndexes.map(({ name }) => name)).sort()
    const liveTables = inventoryA.filter((entry) => entry.startsWith("table "))
      .map((entry) => entry.split(" ")[1]).sort()
    const liveIndexes = inventoryA.filter((entry) => entry.startsWith("index "))
      .map((entry) => entry.split(" ")[1]).sort()

    check("26 domain tables, the same names as the SQLite baseline", () => {
      assert.deepEqual(liveTables, goldenTables)
      assert.equal(liveTables.length, 26)
    })
    check("30 explicit indexes, the same names as the SQLite baseline", () => {
      assert.deepEqual(liveIndexes, goldenIndexes)
      assert.equal(liveIndexes.length, 30)
    })
    check("60 triggers, 98 named checks, 7 functions", () => {
      assert.equal(countOf(inventoryA, "trigger"), 60)
      assert.equal(countOf(inventoryA, "check"), 98)
      assert.equal(countOf(inventoryA, "function"), 7)
    })
    check("every check constraint is named and within 63 characters", () => {
      const names = inventoryA.filter((entry) => entry.startsWith("check "))
        .map((entry) => entry.split(" ")[1])
      for (const name of names) {
        assert.ok(name.length <= 63, name)
        assert.doesNotMatch(name, /_check\d*$/u, `${name} looks auto-generated`)
      }
      assert.equal(new Set(names).size, names.length, "check names are unique")
    })
    check("the deferrable lineage foreign key kept its deferrability", () => {
      const entry = inventoryA.find((row) => row.startsWith("foreign-key issued_invoices_lineage_fkey"))
      assert.ok(entry, "lineage foreign key present")
      assert.match(entry, /DEFERRABLE INITIALLY DEFERRED/u)
      assert.match(entry, /\(organization_id, direct_source_proforma_id, id\)/u)
    })
    const { rows: collation } = await first.query(
      "SELECT datcollate, datctype, pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname=current_database()")
    check("database collation is C/C/UTF8", () => {
      assert.deepEqual(collation[0], { datcollate: "C", datctype: "C", encoding: "UTF8" })
    })

    // ------------------------------------------- triggers vs the capture
    const goldenTriggers = JSON.parse(readFileSync(new URL(
      "../standalone/parity/sqlite-baseline-triggers.json", import.meta.url), "utf8"))
    const liveTriggers = (await first.query(TRIGGER_ROWS)).rows
    check("every trigger matches the frozen SQLite capture", () => {
      assert.deepEqual(triggerDifferences(goldenTriggers, liveTriggers), [])
      assert.equal(liveTriggers.length, goldenTriggers.total)
    })
    check("the trigger comparator reports a mutated trigger (it is not vacuous)", () => {
      const mutate = (name, change) => liveTriggers.map((row) => row.name === name ? { ...row, ...change } : row)
      const cases = [
        ["table", mutate("audit_events_no_update", { table_name: "audit_events_other" })],
        ["event", mutate("audit_events_no_update", { on_update: false, on_delete: true })],
        ["timing", mutate("audit_events_no_update", { before: false })],
        ["updateOf", mutate("proformas_actor_no_update", { update_of: [] })],
        ["message", mutate("proformas_no_delete", {
          definition: "CREATE TRIGGER x BEFORE DELETE ON proformas FOR EACH ROW EXECUTE FUNCTION qwbe_abort('other')",
        })],
        ["predicate", mutate("invoice_drafts_bucharest_sector_insert", {
          definition: "CREATE TRIGGER x BEFORE INSERT ON invoice_drafts FOR EACH ROW"
            + " WHEN ((new.issuer_county = 'RO-B'::text)) EXECUTE FUNCTION qwbe_abort('Bucharest sector is required')",
        })],
        ["predicateHome", mutate("proforma_lines_no_late_insert", { has_when: true })],
        ["missing", liveTriggers.filter(({ name }) => name !== "proformas_no_delete")],
      ]
      for (const [label, mutated] of cases) {
        assert.notDeepEqual(triggerDifferences(goldenTriggers, mutated), [], label)
      }
    })
    check("the 11 UPDATE OF column lists and the 6 moved predicates match the capture", () => {
      const withUpdateOf = liveTriggers.filter((row) => row.update_of.length > 0).map(({ name }) => name).sort()
      assert.deepEqual(withUpdateOf, [...goldenTriggers.withUpdateOf].sort())
      assert.equal(withUpdateOf.length, 11)
      const inBody = liveTriggers.filter((row) => translatedPredicate(row).where === "body")
        .map(({ name }) => name).sort()
      assert.deepEqual(inBody, [...goldenTriggers.withSubqueryInWhen].sort())
      assert.equal(inBody.length, 6)
      // The other 54 keep their predicate (or their unconditional firing) in the trigger.
      assert.equal(liveTriggers.filter((row) => row.has_when).length,
        goldenTriggers.triggers.filter((t) => t.when !== null && !t.whenUsesSubquery).length)
    })

    // ----------------------------------------------- ownership, per scope
    const ownership = await createDatabase(admin, "gate_ownership")
    pools.push(ownership)
    const ownershipClient = await ownership.connect()
    const observed = []
    try {
      for (const scope of migrationScopes) {
        const before = await ownershipClient.query(
          "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")
        for (const migration of scope.migrations) {
          for (const statement of migration.statements) await ownershipClient.query(statement)
        }
        const after = await ownershipClient.query(
          "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")
        const names = new Set(before.rows.map(({ relname }) => relname))
        observed.push({
          scope: scope.scope,
          created: after.rows.map(({ relname }) => relname).filter((name) => !names.has(name)).sort(),
          declared: [...scope.tables].sort(),
        })
      }
    } finally {
      ownershipClient.release()
    }
    check("each scope creates exactly the tables it declares", () => {
      for (const { scope, created, declared } of observed) assert.deepEqual(created, declared, scope)
    })
    check("the ownership comparison fails on a wrong owner", () => {
      const [a, b] = observed.filter(({ declared }) => declared.length > 0)
      assert.throws(() => assert.deepEqual(a.created, b.declared))
    })
    check("the ownership comparison fails on an extra table", () => {
      const scope = observed.find(({ created }) => created.length > 0)
      assert.throws(() => assert.deepEqual([...scope.created, "zz_extra"], scope.declared))
    })

    // ------------------------------------- bare DDL, scope dependencies
    const dependencies = []
    for (const scope of migrationScopes.filter(({ scope: name }) => name !== "foundation")) {
      const bare = await createDatabase(admin, `gate_bare_${scope.scope.replace(/[^a-z]/gu, "")}`)
      pools.push(bare)
      const client = await bare.connect()
      try {
        let outcome = { ok: true }
        for (const migration of scope.migrations) {
          for (const statement of migration.statements) {
            try { await client.query(statement) } catch (error) { outcome = { ok: false, ...failed(error) }; break }
          }
          if (!outcome.ok) break
        }
        dependencies.push({ scope: scope.scope, ...outcome })
      } finally {
        client.release()
      }
    }
    check("a scope applied without its dependencies fails loudly", () => {
      const byScope = Object.fromEntries(dependencies.map((entry) => [entry.scope, entry]))
      // Observed dependency map, asserted rather than assumed.
      assert.equal(byScope.customers.ok, true, "customers stands alone")
      assert.equal(byScope.catalog.ok, true, "catalog stands alone")
      assert.equal(byScope.issuer.ok, true, "issuer stands alone")
      assert.equal(byScope.standalone.ok, true, "standalone sessions stand alone")
      assert.equal(byScope.invoicing.ok, false, "invoicing needs issuers, customers and the foundation")
      assert.equal(byScope.payments.ok, false, "payments needs issued_invoices and the foundation")
      assert.equal(byScope.documents.ok, false, "documents needs the foundation function")
      assert.equal(byScope.documents.code, "42883", "missing qwbe_abort")
    })

    // ------------------------------------------------------ fault cases
    // The collation precondition is asserted on the TARGET before any write.
    // musl maps LC_COLLATE 'C.UTF-8' back to 'C' but keeps LC_CTYPE, so this
    // database is genuinely not the target shape.
    const nonC = await createDatabase(admin, "gate_non_c", { collate: "C.UTF-8", ctype: "C.UTF-8" })
    pools.push(nonC)
    const { rows: nonCLocale } = await nonC.query(
      "SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()")
    let collationRefusal
    try { await applyMigrations(nonC) } catch (error) { collationRefusal = error.message }
    const nonCTables = await nonC.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")
    check("the target locale really differs from C", () => {
      assert.notDeepEqual(nonCLocale[0], { datcollate: "C", datctype: "C" })
    })
    check("migration refuses a non-C database before writing anything", () => {
      assert.match(String(collationRefusal), /must be LC_COLLATE 'C' LC_CTYPE 'C'/u)
      assert.deepEqual(nonCTables.rows, [], "nothing was created")
    })
    const guardOnC = await assertCollationC(first).then(() => "ok", (error) => error.message)
    check("the same guard passes on a C database", () => { assert.equal(guardOnC, "ok") })

    // A held barrier refuses within a bound instead of hanging: the shape a
    // `migrate` needs while the application holds the barrier SHARED.
    const holder = await first.connect()
    let barrierRefusal
    let barrierMillis
    try {
      await acquireSharedMaintenanceLock(holder)
      const begunAt = Date.now()
      try { await applyMigrations(first, { attempts: 3, delayMillis: 50 }) } catch (error) {
        barrierRefusal = error.message
      }
      barrierMillis = Date.now() - begunAt
    } finally {
      await releaseSharedMaintenanceLock(holder)
      holder.release()
    }
    check("a held barrier refuses the migration within its bound", () => {
      assert.match(String(barrierRefusal), /the application is running/u)
      assert.ok(barrierMillis < 5000, `took ${barrierMillis}ms`)
    })
    const afterBarrier = await bounded("post-barrier apply", 60000, applyMigrations(first))
    check("the barrier is free again once the holder releases", () => {
      assert.equal(afterBarrier.changed, 0)
    })

    // --------------------------------------------------- behaviour parity
    const { seedStatements } = await import("./pg-schema-seed-lib.mjs")
    const { acceptedWrites, constraintCases, triggerRejections } = await import("./pg-schema-behaviour-lib.mjs")
    const behaviour = await createDatabase(admin, "gate_behaviour")
    pools.push(behaviour)
    const behaviourClient = await behaviour.connect()
    try {
      await applyMigrationsOnClient(behaviourClient)
      await behaviourClient.query("BEGIN")
      // The deferrable cycle: the invoice and its conversion row land together.
      await behaviourClient.query("SET CONSTRAINTS ALL DEFERRED")
      for (const statement of seedStatements) {
        try {
          await behaviourClient.query(statement)
        } catch (error) {
          throw new Error(`seed failed on ${statement.slice(0, 70)}…`, { cause: error })
        }
      }
      await behaviourClient.query("COMMIT")
      results.push({ name: "the seed is accepted in full (accept half of the matrix)", ok: true })

      await behaviourClient.query("BEGIN")
      const triggerNames = new Set((await behaviourClient.query(
        "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal",
      )).rows.map(({ tgname }) => tgname))
      check("every trigger in the database has a parity case", () => {
        const covered = new Set(triggerRejections.map(([name]) => name))
        assert.deepEqual([...triggerNames].filter((name) => !covered.has(name)), [], "uncovered triggers")
        assert.deepEqual([...covered].filter((name) => !triggerNames.has(name)), [], "cases without a trigger")
        assert.equal(covered.size, 60)
      })

      for (const [trigger, sql, message] of triggerRejections) {
        const outcome = await attempt(behaviourClient, sql)
        check(`trigger ${trigger} refuses the write`, () => {
          assert.equal(outcome.ok, false, "statement was accepted")
          assert.equal(outcome.code, "23514", outcome.message)
          assert.ok(outcome.message.includes(message), `message was ${JSON.stringify(outcome.message)}`)
        })
      }
      for (const [label, sql] of acceptedWrites) {
        const outcome = await attempt(behaviourClient, sql)
        check(`accepted: ${label}`, () => { assert.equal(outcome.ok, true, outcome.message) })
      }
      for (const [label, codes, sql] of constraintCases) {
        const outcome = await attempt(behaviourClient, sql)
        check(`constraint: ${label}`, () => {
          assert.equal(outcome.ok, false, "statement was accepted")
          assert.ok(codes.split("|").includes(outcome.code), `${outcome.code} ${outcome.message}`)
        })
      }

      // STRICT is gone, and the delta is recorded rather than patched over.
      // A raw SQL numeric literal is assignment-cast into an integer column and
      // rounds; a BOUND parameter is sent as text and is rejected. Every adapter
      // is parameterized, so the rounding path is not reachable from the API.
      const rawLiteral = await attempt(behaviourClient,
        "INSERT INTO invoice_sequences VALUES('org-1',2030,'invoice','INV',7.5)")
      await behaviourClient.query("SAVEPOINT num")
      await behaviourClient.query("INSERT INTO invoice_sequences VALUES('org-1',2030,'invoice','INV',7.5)")
      const rounded = await behaviourClient.query(
        "SELECT last_number FROM invoice_sequences WHERE fiscal_year=2030")
      await behaviourClient.query("ROLLBACK TO SAVEPOINT num")
      check("a raw numeric literal is assignment-cast and rounds (SQLite STRICT refused it)", () => {
        assert.equal(rawLiteral.ok, true, rawLiteral.message)
        assert.equal(rounded.rows[0].last_number, 8)
      })
      for (const [label, value] of [["a JS number", 7.5], ["a text fraction", "0.6"]]) {
        await behaviourClient.query("SAVEPOINT bind")
        let code
        try {
          await behaviourClient.query(
            "INSERT INTO invoice_sequences VALUES('org-1',2031,'invoice','INV',$1)", [value])
        } catch (error) { code = error.code }
        await behaviourClient.query("ROLLBACK TO SAVEPOINT bind")
        check(`a bound fraction (${label}) is refused with 22P02`, () => { assert.equal(code, "22P02") })
      }
      const boolRounding = await attempt(behaviourClient,
        `INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,
         party_type,vat_registered) VALUES('c-round','org-1','X','1','RO','X','Y','RO-IS','company',0.6)`)
      check("a raw 0.6 rounds to 1 and satisfies CHECK IN(0,1) — recorded, not endorsed", () => {
        assert.equal(boolRounding.ok, true, boolRounding.message)
      })

      // The generated column, read rather than written.
      const generated = await behaviourClient.query(
        "SELECT id, direct_source_proforma_id FROM issued_invoices ORDER BY id")
      check("the generated column mirrors a proforma-sourced invoice only", () => {
        assert.deepEqual(generated.rows, [
          { id: "invoice-1", direct_source_proforma_id: null },
          { id: "invoice-3", direct_source_proforma_id: "pf-3" },
        ])
      })

      // Dialect vectors, replayed from the frozen SQLite capture.
      const dialect = JSON.parse(readFileSync(new URL("../standalone/parity/sqlite-dialect-behavior.json",
        import.meta.url), "utf8"))
      const vectorInsert = {
        product_presets: (value) => ["INSERT INTO product_presets(id,organization_id,description,unit_price,"
          + "unit_code,unit_name) VALUES('vec','org-1','X',$1,'C62','unitate')", [value]],
        document_series: (value) => ["INSERT INTO document_series VALUES('org-1','invoice',$1)", [value]],
        idempotency_records: (value) => ["INSERT INTO idempotency_records(organization_id,idempotency_key,"
          + "operation,fingerprint,result_kind,result_id,created_at) VALUES('org-1','vec','create_draft',$1,"
          + "'invoice','invoice-1','t')", [value]],
        payment_idempotency_records: (value) => ["INSERT INTO payment_idempotency_records(organization_id,"
          + "idempotency_key,operation,fingerprint,result_id,created_at) VALUES('org-1','vec',"
          + "'record_payment',$1,'pay-1','t')", [value]],
      }
      let globChecked = 0
      for (const predicate of dialect.checkPredicates) {
        for (const { value, outcomes } of predicate.results) {
          const expectAccept = outcomes.every(({ outcome }) => outcome === "satisfied")
          const [sql, values] = vectorInsert[predicate.table](value)
          await behaviourClient.query("SAVEPOINT vec")
          let accepted = true
          let code
          try { await behaviourClient.query(sql, values) } catch (error) { accepted = false; code = error.code }
          await behaviourClient.query("ROLLBACK TO SAVEPOINT vec")
          globChecked += 1
          check(`${predicate.table}.${predicate.column} vector ${JSON.stringify(value)}`, () => {
            if (expectAccept) assert.equal(accepted, true, `rejected with ${code}`)
            else { assert.equal(accepted, false, "accepted"); assert.equal(code, "23514") }
          })
        }
      }
      results.push({ name: `GLOB vectors replayed from the SQLite capture: ${globChecked}`, ok: globChecked > 0 })

      let jsonChecked = 0
      for (const vector of dialect.jsonValid) {
        await behaviourClient.query("SAVEPOINT js")
        let accepted = true
        let code
        try {
          await behaviourClient.query(`INSERT INTO issuers(organization_id,legal_name,tax_identifier,
            country_code,city,street,county,default_currency,default_payment_term_days,branding,legal_form,
            trade_registry_number,iban,bank_name,social_capital)
            VALUES('org-json','X','1','RO','X','Y','RO-IS','RON',15,$1,'srl','J','I','B','1.00')`, [vector.value])
        } catch (error) { accepted = false; code = error.code }
        await behaviourClient.query("ROLLBACK TO SAVEPOINT js")
        jsonChecked += 1
        check(`json vector ${vector.label}`, () => {
          if (vector.jsonValid === 1) assert.equal(accepted, true, `rejected with ${code}`)
          else { assert.equal(accepted, false, "accepted"); assert.equal(code, "23514") }
        })
      }
      check("all 23 JSON vectors replayed", () => { assert.equal(jsonChecked, 23) })

      // NULL branding stays allowed, the IS NULL arm of the CHECK.
      const nullBranding = await attempt(behaviourClient, `INSERT INTO issuers(organization_id,legal_name,
        tax_identifier,country_code,city,street,county,default_currency,default_payment_term_days,branding,
        legal_form,trade_registry_number,iban,bank_name,social_capital)
        VALUES('org-null','X','1','RO','X','Y','RO-IS','RON',15,NULL,'srl','J','I','B','1.00')`)
      check("NULL JSON column stays accepted", () => { assert.equal(nullBranding.ok, true, nullBranding.message) })

      // IS DISTINCT FROM, the NULL <-> value pair the SQLite `IS NOT` carried.
      const distinct = await behaviourClient.query(
        "SELECT (NULL::text IS DISTINCT FROM 'INV') AS a, ('INV' IS DISTINCT FROM 'INV') AS b")
      check("IS DISTINCT FROM keeps the NULL semantics of SQLite IS NOT", () => {
        assert.deepEqual(distinct.rows[0], { a: true, b: false })
      })

      // The ASCII fold the NOCASE index was replaced with.
      const fold = await behaviourClient.query(
        "SELECT translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') AS folded", ["ĂLPHA"])
      check("the fold is ASCII-only, like NOCASE", () => {
        assert.equal(fold.rows[0].folded, "Ălpha")
      })

      await behaviourClient.query("ROLLBACK")

      // The deferred lineage key still fires, at COMMIT and NOT at INSERT.
      // The two statements are asserted separately on the same client and the
      // same transaction: a NOT DEFERRABLE key would fail at the INSERT.
      await behaviourClient.query("BEGIN")
      let insertFailure
      let deferredCode
      try {
        await behaviourClient.query(`INSERT INTO issued_invoices(id,draft_id,organization_id,fiscal_year,
          document_type,series,number,issue_date,issued_at,currency,issuer_legal_name,issuer_tax_identifier,
          issuer_country_code,issuer_city,issuer_street,issuer_county,customer_legal_name,
          customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
          total_excluding_tax,tax_total,total_including_tax,customer_party_type,customer_vat_registered,
          source_proforma_id,issuer_legal_form,issuer_trade_registry_number,issuer_iban,issuer_bank_name,
          issuer_social_capital,actor_id,issuer_vat_registered)
          VALUES('inv-deferred',NULL,'org-1',2026,'invoice','INV',7,'2026-09-01','t','RON','F','1','RO','X',
          'Y','RO-IS','C','2','RO','X','Y','RO-IS','1.00','0.00','1.00','company',1,'pf-1','srl','J','I','B',
          '1.00','operator',1)`)
      } catch (error) {
        insertFailure = error.code ?? error.message
      }
      if (insertFailure === undefined) {
        try { await behaviourClient.query("COMMIT") } catch (error) { deferredCode = error.code }
      }
      try { await behaviourClient.query("ROLLBACK") } catch { /* already ended */ }
      check("the deferred lineage key does not fire at INSERT", () => {
        assert.equal(insertFailure, undefined, "the INSERT was refused, so the key is not deferred")
      })
      check("the deferred lineage key fires at COMMIT with 23503", () => {
        assert.equal(deferredCode, "23503")
      })
    } finally {
      behaviourClient.release()
    }
  } finally {
    for (const pool of pools) {
      try { await bounded("pool end", 10000, pool.end()) } catch (error) { console.error("·", error.message) }
    }
    for (const name of databases) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) } catch (error) {
        console.error("· drop", name, error.message)
      }
    }
    await admin.end()
  }
}

await bounded("gate", 600000, main()).catch((error) => {
  results.push({ name: "gate", ok: false, detail: error instanceof Error ? error.stack : String(error) })
})

const passed = results.filter(({ ok }) => ok).length
for (const { name, ok, detail } of results) if (!ok) console.error(`FAIL ${name}\n     ${detail}`)
console.log(`${passed}/${results.length} checks passed in ${Date.now() - started}ms`)
process.exit(passed === results.length ? 0 : 1)
