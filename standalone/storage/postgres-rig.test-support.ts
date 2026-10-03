import { randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Pool } from "pg"

import type { RuntimeConfig } from "../config.ts"
import { applyMigrations } from "./postgres-migrations.ts"
import {
  createPostgresRuntime,
  createQueryPool,
  createQueryRuntime,
  type PostgresRuntime,
  type PostgresSettings,
} from "./postgres-pool.ts"

/**
 * The one PostgreSQL test rig: a fresh, empty database per test file (and per
 * case where a case has to see an empty one) on the throwaway PostgreSQL 16
 * cluster of `compose.test.yaml`.
 *
 * Deliberately not a mock. Every suite that used to open `node:sqlite` directly
 * is judged on the real schema — the triggers, the CHECKs, the folded index and
 * the deferred FK cycle are the behaviour under test, and none of them exist in
 * a fake. There is no SQLite compatibility layer here and no SQL translation at
 * runtime: `RawSql` below is a test-only parameterised query helper, nothing
 * more.
 *
 * Nothing existing is removed or reset. Every database this rig touches it
 * created itself, with a name it validates first, and a fixture gives its own
 * database back on `close` (`dropTestDatabase`) so a full run does not keep
 * ninety databases' worth of tmpfs pages alive. The `freshRuntime` /
 * `emptyRuntime` helpers below do not drop — their callers measure pool
 * lifecycle, not storage — so their databases live until the container dies,
 * which is also the only cleanup anything here relies on.
 */

const identifier = /^[a-z][a-z0-9_]{0,48}$/u

/**
 * The password is read from `PGPASSWORD_FILE` when the rig sets one, exactly as
 * `standalone/config.ts` reads it, so the suite exercises the secret-file path
 * rather than a convenience variable. `PGPASSWORD` stays supported for the
 * `trust` rigs, where it is the empty string.
 */
const riggedPassword = (): string => {
  const file = process.env.PGPASSWORD_FILE
  if (file !== undefined && file.length > 0) return readFileSync(file, "utf8").trim()
  return process.env.PGPASSWORD ?? ""
}

const settings = (database: string): PostgresSettings => ({
  host: process.env.PGHOST ?? "db",
  port: Number(process.env.PGPORT ?? "5432"),
  database,
  user: process.env.PGUSER ?? "adapters",
  password: riggedPassword(),
  statementTimeoutMillis: 4_000,
  lockTimeoutMillis: 3_000,
  idleTransactionTimeoutMillis: 8_000,
  connectTimeoutMillis: 3_000,
})

export const testSettings = settings

/**
 * The cluster's own database: where `CREATE DATABASE` is issued from, and the
 * only database in the rig that no test owns. Exported because a test that
 * terminates advisory-lock holders has to prove it did not reach across
 * databases, and the peer it keeps alive lives here.
 */
export const rigMaintenanceDatabase = (): string => process.env.PGDATABASE ?? "adapters"

const maintenanceDatabase = rigMaintenanceDatabase

/**
 * Every pool the rig opens is built by the production builder, and that is not
 * cosmetic. `PostgresSettings` is camelCase and `pg`'s own `PoolConfig` is not:
 * `new Pool({ ...settings(database) })` silently ignores
 * `statementTimeoutMillis`, `lockTimeoutMillis` and
 * `idleTransactionTimeoutMillis`, and the connection then runs with
 * `statement_timeout = 0`. Unbounded is the worst outcome for a rig pool,
 * because the statements it runs are exactly the ones that wait on a lock:
 * `pg_advisory_lock(1480, 9001)`, `DROP DATABASE … WITH (FORCE)` behind a live
 * connection, and `ALTER TABLE … DISABLE TRIGGER USER`, which needs ACCESS
 * EXCLUSIVE. With no bound the file hangs instead of failing, and a hang in
 * `node --test` names no assertion.
 *
 * `createQueryPool` maps each bound to the server-side GUC, so the values are
 * readable back with `SHOW` — `postgres-rig.test.ts` does exactly that for all
 * three pools below.
 *
 * The bounds are deliberately larger than the application's: a maintenance
 * statement waits behind up to ninety serialised `CREATE DATABASE` calls, and a
 * fixture seeds hundreds of rows while three other files share the server.
 * Larger, still bounded.
 */
const rigPool = (database: string, overrides: Partial<PostgresSettings>): Pool =>
  createQueryPool({ ...settings(database), ...overrides })

/**
 * The very pool `createTestDatabase` and the reclaim open, exposed so a test can
 * read its bounds back with `SHOW` instead of trusting this file's arithmetic.
 * The caller ends it.
 */
export const openRigMaintenancePool = (): Pool => rigPool(maintenanceDatabase(), maintenancePoolSettings)

/** Creation and reclaim: one connection, long but bounded waits. */
const maintenancePoolSettings = {
  maxConnections: 1,
  idleTimeoutMillis: 1_000,
  statementTimeoutMillis: 60_000,
  lockTimeoutMillis: 60_000,
  connectTimeoutMillis: 5_000,
} as const satisfies Partial<PostgresSettings>

let created = 0

/**
 * `CREATE DATABASE` cannot run inside a transaction and two of them collide on
 * the template, so the creation is serialised through a session advisory lock on
 * the maintenance connection — not through the maintenance barrier, which is the
 * application's.
 */
export const createTestDatabase = async (label: string): Promise<string> => {
  created += 1
  // Random, not the pid: the rig's `db` container outlives a `run --rm`, so a
  // second run in the same container would collide on a pid-derived name.
  const name = `t_${label}_${randomBytes(4).toString("hex")}_${String(created)}`.toLowerCase()
  if (!identifier.test(name)) throw new Error(`invalid test database name: ${name}`)
  const pool = rigPool(maintenanceDatabase(), maintenancePoolSettings)
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(1480, 9001)")
    try {
      // The target cluster's collation, asserted by the schema gate: C/C/UTF8.
      await client.query(
        `CREATE DATABASE ${name} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`,
      )
    } finally {
      await client.query("SELECT pg_advisory_unlock(1480, 9001)")
    }
  } finally {
    client.release()
    await pool.end()
  }
  return name
}

/**
 * Gives a test database back to the cluster, and only one this rig created: the
 * name is validated against the same pattern `createTestDatabase` built it with,
 * so nothing else can be named here. `WITH (FORCE)` because a case that leaked a
 * connection must not keep the database — and therefore its tmpfs pages — alive
 * for the rest of the run.
 *
 * A failure is swallowed deliberately. The cluster is a throwaway on tmpfs and
 * dies with its container, so an undropped database is at worst wasted space;
 * failing `close` here would turn that into a failing test for a reason that has
 * nothing to do with what the test asserted.
 */
const dropTestDatabase = async (name: string): Promise<void> => {
  if (!identifier.test(name)) throw new Error(`invalid test database name: ${name}`)
  const pool = rigPool(maintenanceDatabase(), maintenancePoolSettings)
  try {
    const client = await pool.connect()
    try {
      await client.query("SELECT pg_advisory_lock(1480, 9001)")
      try {
        await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      } finally {
        await client.query("SELECT pg_advisory_unlock(1480, 9001)")
      }
    } finally {
      client.release()
    }
  } catch {
    // See above: reclaiming space is best effort.
  } finally {
    await pool.end()
  }
}

/**
 * `pool.end()` never resolves while a case still holds a checked-out client, and
 * in `fixture.close()` that wait happens inside a `finally`: the file stalls
 * with no failing assertion to point at, which is the hang this rig has already
 * produced once. The wait is therefore bounded. After the deadline the close
 * carries on to the reclaim below, which forces whatever was still connected
 * off, and the leak is printed so the file that caused it is identifiable from
 * the log instead of from a stack that never arrives.
 */
const closeWithin = async (label: string, millis: number, close: () => Promise<void>): Promise<void> => {
  let timer: NodeJS.Timeout | undefined
  const attempt = close().then(() => "closed" as const)
  // The deadline may win the race; without this the later rejection would be
  // unhandled and would end the test process instead of failing one file.
  attempt.catch(() => undefined)
  try {
    const outcome = await Promise.race([
      attempt,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => { resolve("timeout") }, millis)
      }),
    ])
    if (outcome === "timeout") {
      console.error(`rig: ${label} did not close within ${String(millis)}ms (a case left a client checked out)`)
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface TestRuntime extends PostgresRuntime {
  readonly database: string
}

/** A fresh database with every migration applied through the real executor. */
export const freshRuntime = async (label: string): Promise<TestRuntime> => {
  const database = await createTestDatabase(label)
  const runtime = createPostgresRuntime(settings(database))
  const report = await applyMigrations(runtime.pool)
  if (report.pending.length > 0 || report.changed === 0) {
    // The database was created here, so it is given back here: a failing helper
    // must not leave its pages behind for the rest of the run.
    await runtime.close()
    await dropTestDatabase(database)
    throw new Error(`migrations did not apply: ${JSON.stringify(report)}`)
  }
  return { ...runtime, database }
}

/** A runtime on a fresh database with no schema, for lifecycle-only checks. */
export const emptyRuntime = async (label: string): Promise<TestRuntime> => {
  const database = await createTestDatabase(label)
  return { ...createPostgresRuntime(settings(database)), database }
}

export const sessionCount = async (pool: Pool, state: string): Promise<number> => {
  const { rows } = await pool.query<{ readonly count: string }>(
    "SELECT count(*) AS count FROM pg_stat_activity WHERE state = $1 AND datname = current_database()",
    [state],
  )
  return Number(rows[0]?.count ?? "0")
}

/**
 * What a refused statement tells a test. The SQLSTATE and the constraint name
 * are the contract — a driver message is not, and the SQLite phrasing the
 * triggers still raise is asserted through `message` only where the contract
 * really carries it (`RAISE … MESSAGE=`).
 */
export interface SqlFailure {
  readonly code: string
  readonly constraint: string | undefined
  readonly table: string | undefined
  readonly message: string
}

const failureOf = (error: unknown): SqlFailure => {
  const candidate = error as { code?: unknown; constraint?: unknown; table?: unknown; message?: unknown }
  if (typeof candidate.code !== "string") throw error
  return {
    code: candidate.code,
    constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined,
    table: typeof candidate.table === "string" ? candidate.table : undefined,
    message: typeof candidate.message === "string" ? candidate.message : "",
  }
}

/**
 * A test-only parameterised query helper, and the one place the engine's
 * transaction rule is handled: PostgreSQL aborts a transaction on the first
 * failed statement, so every call here runs in autocommit on a pooled client.
 * A caller can therefore probe twenty negative cases in a row exactly as the
 * SQLite suites did, without one refusal poisoning the next.
 *
 * It is NOT an adapter and not a `DatabaseSync` shim: no synchronous entry
 * point, no SQL rewriting, no dialect translation. `?` placeholders do not
 * exist here — every statement is written in PostgreSQL with `$N`.
 */
export interface RawSql {
  /** Every row of a statement, as plain objects. */
  readonly query: <Row extends object = Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<Row>>
  /** The first row, or `undefined` — the shape `.get()` had. */
  readonly one: <Row extends object = Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<Row | undefined>
  /** The first column of the first row. */
  readonly scalar: (text: string, values?: ReadonlyArray<unknown>) => Promise<unknown>
  /** How many rows a write touched. */
  readonly rowCount: (text: string, values?: ReadonlyArray<unknown>) => Promise<number>
  /** A multi-statement script, one round trip, implicit transaction. */
  readonly exec: (text: string) => Promise<void>
  /**
   * Asserts the statement is refused and answers what refused it. Throws if the
   * statement is accepted, so a test cannot pass because the engine stopped
   * enforcing something.
   */
  readonly rejects: (text: string, values?: ReadonlyArray<unknown>) => Promise<SqlFailure>
  /**
   * The same, for a sequence of statements that must be sent on one connection
   * inside one transaction — a deferred constraint fires at `COMMIT`, not at the
   * `INSERT`, so the two cannot be separate autocommit calls.
   */
  readonly transaction: <Value>(use: (client: RawSql) => Promise<Value>) => Promise<Value>
  /**
   * Seeding data the application could never write: `session_replication_role =
   * replica` suspends every user trigger and every foreign-key trigger for this
   * one session. CHECK constraints, NOT NULL and unique indexes still fire —
   * which is the point, because that is what such a fixture is asserting.
   */
  readonly withoutTriggers: <Value>(use: (client: RawSql) => Promise<Value>) => Promise<Value>
  /**
   * Offline corruption, simulated in a disposable database: the user triggers of
   * these tables are disabled and their named CHECK constraints are dropped, for
   * good, so a row the application could never write can be stored and the
   * reader's own validation can be measured on it.
   *
   * It is the counterpart of SQLite's `DROP TRIGGER` loop plus
   * `PRAGMA ignore_check_constraints=ON`; PostgreSQL has no such switch, and a
   * CHECK can only be removed by name — which every one of them now has.
   * Answers what it removed, so a caller can prove it removed something.
   */
  readonly unguard: (tables: ReadonlyArray<string>) => Promise<{
    readonly triggers: ReadonlyArray<string>
    readonly checks: ReadonlyArray<string>
  }>
  /** The CHECK constraints of a table, by name, straight out of the catalogue. */
  readonly checkNames: (table: string) => Promise<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

type Queryable = {
  query: (text: string, values?: ReadonlyArray<unknown>) => Promise<{ rows: ReadonlyArray<object>; rowCount: number | null }>
}

const sqlOn = (
  execute: <Value>(use: (queryable: Queryable) => Promise<Value>) => Promise<Value>,
  close: () => Promise<void>,
): RawSql => {
  const self: RawSql = {
    query: <Row extends object>(text: string, values?: ReadonlyArray<unknown>) =>
      execute(async (queryable) => {
        const result = await queryable.query(text, values)
        return result.rows.map((row) => ({ ...row })) as unknown as ReadonlyArray<Row>
      }),
    one: async <Row extends object>(text: string, values?: ReadonlyArray<unknown>) =>
      (await self.query<Row>(text, values))[0],
    scalar: async (text, values) => {
      const row = await self.one(text, values)
      return row === undefined ? undefined : Object.values(row)[0]
    },
    rowCount: (text, values) => execute(async (queryable) => (await queryable.query(text, values)).rowCount ?? 0),
    exec: (text) => execute(async (queryable) => { await queryable.query(text) }),
    rejects: async (text, values) => {
      try {
        await self.query(text, values)
      } catch (error) {
        return failureOf(error)
      }
      throw new Error(`statement was accepted but had to be refused: ${text}`)
    },
    transaction: (use) => execute(async (queryable) => {
      const scoped = sqlOn((run) => run(queryable), () => Promise.resolve())
      await queryable.query("BEGIN")
      try {
        const value = await use(scoped)
        await queryable.query("COMMIT")
        return value
      } catch (error) {
        try {
          await queryable.query("ROLLBACK")
        } catch {
          // The original failure is the interesting one; a rollback on a dead
          // connection must not replace it.
        }
        throw error
      }
    }),
    withoutTriggers: (use) => execute(async (queryable) => {
      const scoped = sqlOn((run) => run(queryable), () => Promise.resolve())
      await queryable.query("SET session_replication_role = replica")
      try {
        return await use(scoped)
      } finally {
        await queryable.query("SET session_replication_role = DEFAULT")
      }
    }),
    unguard: async (tables) => {
      const triggers: Array<string> = []
      const checks: Array<string> = []
      for (const table of tables) {
        if (!identifier.test(table)) throw new Error(`unguard takes a plain table name: ${table}`)
        const named = await self.query<{ readonly tgname: string }>(
          `SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
          [table],
        )
        await self.exec(`ALTER TABLE ${table} DISABLE TRIGGER USER`)
        triggers.push(...named.map(({ tgname }) => tgname))
        for (const name of await self.checkNames(table)) {
          await self.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`)
          checks.push(name)
        }
      }
      return { triggers, checks }
    },
    checkNames: async (table) => (await self.query<{ readonly conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE contype = 'c' AND conrelid = $1::regclass ORDER BY conname`,
      [table],
    )).map(({ conname }) => conname),
    close,
  }
  return self
}

/**
 * A `RawSql` on its own small pool. It is separate from the application pool on
 * purpose: a fixture that seeds twenty rows must not consume the four
 * connections the code under test is being measured on.
 */
const rawSql = (database: string): RawSql => {
  const pool = rigPool(database, {
    maxConnections: 2,
    idleTimeoutMillis: 1_000,
    statementTimeoutMillis: 30_000,
    lockTimeoutMillis: 15_000,
  })
  return sqlOn(async (use) => {
    const client = await pool.connect()
    try {
      return await use(client)
    } finally {
      client.release()
    }
  }, () => pool.end())
}

/**
 * Everything a ported suite needs, and nothing it has to assemble itself: the
 * application pool, the artifact directory, raw SQL, a complete `RuntimeConfig`
 * and the environment a child process has to be handed.
 */
export interface TestFixture {
  readonly database: string
  readonly settings: PostgresSettings
  /** The application pool, max 4. Owned by the fixture; `close` ends it. */
  readonly pool: Pool
  /** `DATA_DIR`: the content-addressed PDFs. Removed by `close`. */
  readonly dataDirectory: string
  readonly sql: RawSql
  /** A full `RuntimeConfig` on this database, so a test never writes `pgSettings`. */
  readonly config: (overrides?: Partial<RuntimeConfig>) => RuntimeConfig
  /**
   * The environment a `spawnSync`ed CLI needs: this database, this data
   * directory, and the secret-file path the rig made readable to the container
   * user. `PGPASSWORD` is never set, exactly as in production.
   */
  readonly childEnv: (overrides?: Readonly<Record<string, string>>) => NodeJS.ProcessEnv
  readonly close: () => Promise<void>
}

const sanitized = (label: string): string => {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "")
  if (cleaned.length === 0) throw new Error(`unusable fixture label: ${label}`)
  return cleaned.slice(0, 20)
}

const fixtureOn = (database: string): TestFixture => {
  const configured = settings(database)
  const runtime = createQueryRuntime(configured)
  const sql = rawSql(database)
  const dataDirectory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "qwbe-fixture-"))
  let closing: Promise<void> | undefined
  return {
    database,
    settings: configured,
    pool: runtime.pool,
    dataDirectory,
    sql,
    config: (overrides = {}) => ({
      host: "127.0.0.1",
      port: 3000,
      dataDirectory,
      nodeEnvironment: "test",
      authTokenFile: undefined,
      organizationId: "org-1",
      pgSettings: configured,
      ...overrides,
    }),
    childEnv: (overrides = {}) => {
      // `PGPASSWORD` is dropped rather than forwarded: a child must prove it can
      // read the secret file, which is what production gives it.
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name !== "PGPASSWORD"),
      )
      return {
        ...inherited,
        PGHOST: configured.host,
        PGPORT: String(configured.port),
        PGDATABASE: database,
        PGUSER: configured.user,
        DATA_DIR: dataDirectory,
        NODE_ENV: "development",
        ...overrides,
      }
    },
    close: () => closing ??= (async () => {
      // Order: the borrowed connections first, then the directory, then the
      // database itself. A pool still holding a client would keep the database
      // busy, and an undropped database keeps its tmpfs pages for the whole run —
      // a full suite is about ninety of them.
      await closeWithin(`${database} raw sql`, 10_000, () => sql.close())
      await closeWithin(`${database} pool`, 10_000, () => runtime.close())
      rmSync(dataDirectory, { recursive: true, force: true })
      await dropTestDatabase(database)
    })(),
  }
}

/** A fixture whose database carries the full migrated schema. */
export const migratedFixture = async (label: string): Promise<TestFixture> => {
  const database = await createTestDatabase(sanitized(label))
  const fixture = fixtureOn(database)
  try {
    const report = await applyMigrations(fixture.pool)
    if (report.pending.length > 0 || report.changed === 0) {
      throw new Error(`migrations did not apply: ${JSON.stringify(report)}`)
    }
  } catch (error) {
    await fixture.close()
    throw error
  }
  return fixture
}

/** A fixture whose database is empty: no schema, no ledger. */
export const emptyFixture = async (label: string): Promise<TestFixture> => {
  const database = await createTestDatabase(sanitized(label))
  return fixtureOn(database)
}

/** The migrated fixture as a bracket, so a test cannot forget to close it. */
export const withMigrated = async <Value>(
  label: string,
  use: (fixture: TestFixture) => Promise<Value>,
): Promise<Value> => {
  const fixture = await migratedFixture(label)
  try {
    return await use(fixture)
  } finally {
    await fixture.close()
  }
}

/** The empty fixture as a bracket. */
export const withEmpty = async <Value>(
  label: string,
  use: (fixture: TestFixture) => Promise<Value>,
): Promise<Value> => {
  const fixture = await emptyFixture(label)
  try {
    return await use(fixture)
  } finally {
    await fixture.close()
  }
}
