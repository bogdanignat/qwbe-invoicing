import assert from "node:assert/strict"
import test from "node:test"

import type { Pool } from "pg"

import { migratedFixture, openRigMaintenancePool } from "./postgres-rig.test-support.ts"

/**
 * The rig's own bounds, measured on the server rather than read off the settings
 * object. This exists because the settings object lied once: `PostgresSettings`
 * is camelCase and `pg`'s `PoolConfig` is not, so a pool built with
 * `new Pool({ ...settings })` ran with `statement_timeout = 0` while the code
 * said 4000. Nothing that waits on a lock may be unbounded here — an unbounded
 * rig statement turns a failure into a hang, and `node --test` cannot name a
 * hang.
 *
 * `SHOW` is the only acceptable evidence: it reports what the backend will
 * actually enforce, including the GUCs `pg` sends at connection time.
 */

interface Bounds {
  readonly statement: string
  readonly lock: string
  readonly idleTransaction: string
}

const boundsOf = async (pool: Pool): Promise<Bounds> => {
  const { rows } = await pool.query<{ readonly name: string; readonly setting: string }>(
    "SELECT name, setting FROM pg_settings"
    + " WHERE name IN ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')",
  )
  const value = (name: string): string => {
    const found = rows.find((row) => row.name === name)
    assert.ok(found !== undefined, `${name} should be reported by the backend`)
    return found.setting
  }
  return {
    statement: value("statement_timeout"),
    lock: value("lock_timeout"),
    idleTransaction: value("idle_in_transaction_session_timeout"),
  }
}

const millis = (setting: string): number => {
  const parsed = Number(setting)
  assert.ok(Number.isFinite(parsed), `a timeout should be a number of milliseconds, got ${setting}`)
  return parsed
}

const assertBounded = (label: string, bounds: Bounds): void => {
  assert.ok(millis(bounds.statement) > 0, `${label}: statement_timeout must be bounded, got ${bounds.statement}`)
  assert.ok(millis(bounds.lock) > 0, `${label}: lock_timeout must be bounded, got ${bounds.lock}`)
  assert.ok(
    millis(bounds.idleTransaction) > 0,
    `${label}: idle_in_transaction_session_timeout must be bounded, got ${bounds.idleTransaction}`,
  )
}

void test("every rig pool runs with bounded statement, lock and idle-transaction timeouts", async () => {
  const fixture = await migratedFixture("rig_bounds")
  try {
    // 1. The application pool the code under test is measured on.
    const application = await boundsOf(fixture.pool)
    assertBounded("application pool", application)
    assert.equal(application.statement, "4000")
    assert.equal(application.lock, "3000")
    assert.equal(application.idleTransaction, "8000")

    // 2. The raw-SQL helper: the one that runs `ALTER TABLE … DISABLE TRIGGER
    //    USER`, which waits for ACCESS EXCLUSIVE.
    const raw = await fixture.sql.query<{ readonly name: string; readonly setting: string }>(
      "SELECT name, setting FROM pg_settings"
      + " WHERE name IN ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')",
    )
    const rawSetting = (name: string): string => {
      const found = raw.find((row) => row.name === name)
      assert.ok(found !== undefined, `${name} should be reported for the raw-SQL pool`)
      return found.setting
    }
    const rawBounds: Bounds = {
      statement: rawSetting("statement_timeout"),
      lock: rawSetting("lock_timeout"),
      idleTransaction: rawSetting("idle_in_transaction_session_timeout"),
    }
    assertBounded("raw sql pool", rawBounds)
    assert.equal(rawBounds.statement, "30000")
    assert.equal(rawBounds.lock, "15000")

    // 3. The maintenance pool: `CREATE DATABASE`, the reclaim and the advisory
    //    lock that serialises both. Longest budget, still a budget.
    const maintenance = openRigMaintenancePool()
    try {
      const bounds = await boundsOf(maintenance)
      assertBounded("maintenance pool", bounds)
      assert.equal(bounds.statement, "60000")
      assert.equal(bounds.lock, "60000")
      // A connect attempt is bounded too, or a server that stopped answering
      // would stall creation instead of failing it.
      const connect = maintenance.options.connectionTimeoutMillis
      assert.ok(
        typeof connect === "number" && connect > 0,
        `maintenance pool: connectionTimeoutMillis must be bounded, got ${String(connect)}`,
      )
    } finally {
      await maintenance.end()
    }

    // The fixture pool's own connect bound, from the same mapping.
    const connect = fixture.pool.options.connectionTimeoutMillis
    assert.ok(
      typeof connect === "number" && connect > 0,
      `application pool: connectionTimeoutMillis must be bounded, got ${String(connect)}`,
    )
  } finally {
    await fixture.close()
  }
})

void test("a rig statement that waits past its bound fails instead of hanging", async () => {
  const fixture = await migratedFixture("rig_bound_bite")
  try {
    // The bound is real, not declared: a lock wait longer than `lock_timeout`
    // comes back as 55P03, which is what keeps a stuck fixture reportable.
    await fixture.sql.exec("CREATE TABLE rig_bound_probe (id integer PRIMARY KEY)")
    const holder = await fixture.pool.connect()
    try {
      await holder.query("BEGIN")
      await holder.query("LOCK TABLE rig_bound_probe IN ACCESS EXCLUSIVE MODE")
      const failure = await fixture.sql.rejects(
        "SET lock_timeout = 250; LOCK TABLE rig_bound_probe IN ACCESS EXCLUSIVE MODE",
      )
      assert.equal(failure.code, "55P03")
      await holder.query("ROLLBACK")
    } finally {
      holder.release()
    }
  } finally {
    await fixture.close()
  }
})
