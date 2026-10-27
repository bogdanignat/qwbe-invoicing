import assert from "node:assert/strict"
import test from "node:test"

import { checkLock, lockOf, migrationHash } from "./migrations-lock.ts"
import { lockUpdate, parseLock } from "./migrations-lock-update.ts"
import type { MigrationScope } from "./postgres-migration-plans.ts"

const scope = (name: string, migrations: ReadonlyArray<readonly [string, string]>): MigrationScope => ({
  scope: name,
  migrations: migrations.map(([migration, sql]) => ({ name: migration, statements: [sql] })),
  tables: [],
})

const shipped = lockOf([
  scope("alpha", [["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"]]),
  scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
])

const check = (scopes: ReadonlyArray<MigrationScope>) => checkLock(shipped, lockOf(scopes))

void test("the hash covers the statements, their order and their boundaries", () => {
  assert.equal(migrationHash(["A", "B"]), migrationHash(["A", "B"]))
  assert.notEqual(migrationHash(["A", "B"]), migrationHash(["B", "A"]))
  assert.notEqual(migrationHash(["AB"]), migrationHash(["A", "B"]))
})

void test("an intact lock passes and an appended migration is only unlocked", () => {
  const intact = [
    scope("alpha", [["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"]]),
    scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
  ]
  assert.deepEqual(check(intact), { broken: [], unlocked: [] })
  const appended = [
    scope("alpha", [
      ["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"], ["alpha-003", "SELECT 1"],
    ]),
    scope("gamma", [["gamma-001", "CREATE TABLE g(id INT)"]]),
    scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
  ]
  assert.deepEqual(check(appended), { broken: [], unlocked: ["alpha/alpha-003", "gamma/gamma-001"] })
})

void test("a shipped migration edited, removed, renamed or moved is broken", () => {
  const beta = scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]])
  const cases: ReadonlyArray<readonly [ReadonlyArray<readonly [string, string]>, string]> = [
    [[["alpha-001", "CREATE TABLE a(id BIGINT)"], ["alpha-002", "ALTER TABLE a ADD b INT"]], "alpha/alpha-001 was edited"],
    [[["alpha-001", "CREATE TABLE a(id INT)"]], "alpha/alpha-002 was removed"],
    [[["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002-b", "ALTER TABLE a ADD b INT"]], "alpha/alpha-002 was removed, renamed"],
    [[["alpha-002", "ALTER TABLE a ADD b INT"], ["alpha-001", "CREATE TABLE a(id INT)"]], "alpha/alpha-001 is no longer migration 1"],
    [[
      ["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-001b", "SELECT 1"], ["alpha-002", "ALTER TABLE a ADD b INT"],
    ], "alpha/alpha-002 is no longer migration 2"],
  ]
  for (const [alpha, expected] of cases) {
    const { broken, unlocked } = check([scope("alpha", alpha), beta])
    assert.ok(broken.some((problem) => problem.startsWith(expected)), `${expected}: ${JSON.stringify(broken)}`)
    assert.deepEqual(unlocked, [])
  }
})

const text = JSON.stringify(shipped)
const intact = [
  scope("alpha", [["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"]]),
  scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
]

void test("a missing or malformed lock is refused, never read as empty", () => {
  const malformed = [
    undefined,
    "not json",
    "{}",
    JSON.stringify([{ scope: "alpha", migrations: [{ name: "alpha-001", sha256: "abc" }] }]),
    JSON.stringify([{ scope: "alpha", migrations: [{ name: "", sha256: "a".repeat(64) }] }]),
    JSON.stringify([{ scope: "alpha", migrations: {} }]),
    JSON.stringify([...shipped, shipped[0]]),
  ]
  for (const candidate of malformed) {
    const update = lockUpdate(candidate, lockOf(intact))
    assert.equal(update.kind, "refused", String(candidate))
    assert.equal(typeof parseLock(candidate), "string")
  }
  const missing = parseLock(undefined)
  assert.ok(typeof missing === "string" && missing.includes("missing"), "a missing lock says so")
  assert.deepEqual(parseLock(text), shipped)
})

void test("a broken lock is never appended to, even with new migrations waiting", () => {
  const update = lockUpdate(text, lockOf([
    scope("alpha", [
      ["alpha-001", "CREATE TABLE a(id BIGINT)"], ["alpha-002", "ALTER TABLE a ADD b INT"], ["alpha-003", "SELECT 1"],
    ]),
    scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
  ]))
  assert.ok(update.kind === "refused", "nothing to write")
  assert.ok(update.problems.some((problem) => problem.includes("alpha-001 was edited")))
})

void test("an intact lock gains only the new migrations, after the locked ones", () => {
  assert.deepEqual(lockUpdate(text, lockOf(intact)), { kind: "unchanged" })
  const update = lockUpdate(text, lockOf([
    scope("alpha", [
      ["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"], ["alpha-003", "SELECT 1"],
    ]),
    scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]]),
    scope("gamma", [["gamma-001", "CREATE TABLE g(id INT)"]]),
  ]))
  assert.ok(update.kind === "append", "only appended")
  assert.deepEqual(update.appended, ["alpha/alpha-003", "gamma/gamma-001"])
  const [alpha, beta, gamma] = update.lock
  assert.deepEqual(alpha?.migrations.slice(0, 2), shipped[0]?.migrations)
  assert.deepEqual(alpha?.migrations.slice(2).map(({ name }) => name), ["alpha-003"])
  assert.deepEqual(beta, shipped[1])
  assert.deepEqual(gamma?.migrations.map(({ name }) => name), ["gamma-001"])
})

void test("a locked scope that is gone or reordered is broken", () => {
  const alpha = scope("alpha", [["alpha-001", "CREATE TABLE a(id INT)"], ["alpha-002", "ALTER TABLE a ADD b INT"]])
  const beta = scope("beta", [["beta-001", "CREATE TABLE b(id INT)"]])
  assert.deepEqual(check([alpha]).broken, ["scope beta is locked but no longer in migrationScopes"])
  assert.deepEqual(check([beta, alpha]).broken, ["the locked scopes are no longer in their locked order"])
})
