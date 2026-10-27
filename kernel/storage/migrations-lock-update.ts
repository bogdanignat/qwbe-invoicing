import { checkLock, type LockedMigration, type LockedScope, type MigrationsLock } from "./migrations-lock.ts"

/**
 * What the lock file allows, decided without touching the file: the gate and
 * `pnpm migrations:lock` both act on this answer, so the rule "nothing is written
 * while anything shipped is broken" lives here and not in the order of a
 * script's branches.
 *
 * A missing or malformed lock is a refusal, never an empty lock: an empty lock
 * would let `rm migrations.lock.json && pnpm migrations:lock` lock every shipped
 * migration again with whatever content it has now.
 */

export const lockPath = "kernel/storage/migrations.lock.json"

export type LockUpdate =
  | { readonly kind: "refused"; readonly problems: ReadonlyArray<string>; readonly hint: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "append"; readonly lock: MigrationsLock; readonly appended: ReadonlyArray<string> }

const sha256 = /^[0-9a-f]{64}$/u

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isMigration = (value: unknown): value is LockedMigration =>
  isRecord(value) && typeof value.name === "string" && value.name.length > 0
  && typeof value.sha256 === "string" && sha256.test(value.sha256)

const isScope = (value: unknown): value is LockedScope =>
  isRecord(value) && typeof value.scope === "string" && value.scope.length > 0
  && Array.isArray(value.migrations) && value.migrations.every(isMigration)

/** The lock, or why the text is not one. */
export const parseLock = (text: string | undefined): MigrationsLock | string => {
  if (text === undefined) return `${lockPath} is missing; restore it from git, it is never rebuilt`
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return `${lockPath} is not JSON`
  }
  if (!Array.isArray(value) || !value.every(isScope)) {
    return `${lockPath} is not a list of { scope, migrations: [{ name, sha256 }] } with 64-hex hashes`
  }
  const scopes = value.map(({ scope }) => scope)
  if (new Set(scopes).size !== scopes.length) return `${lockPath} names a scope twice`
  return value
}

/** The old lock, entry for entry, with only what follows each scope's locked prefix added. */
const appendedLock = (lock: MigrationsLock, current: MigrationsLock): MigrationsLock =>
  current.map((scope) => {
    const locked = lock.find((entry) => entry.scope === scope.scope)
    if (locked === undefined) return scope
    return { ...locked, migrations: [...locked.migrations, ...scope.migrations.slice(locked.migrations.length)] }
  })

export const lockUpdate = (text: string | undefined, current: MigrationsLock): LockUpdate => {
  const lock = parseLock(text)
  if (typeof lock === "string") {
    return { kind: "refused", problems: [lock], hint: "the lock is only ever appended to; nothing was written" }
  }
  const { broken, unlocked } = checkLock(lock, current)
  if (broken.length > 0) {
    return {
      kind: "refused",
      problems: broken,
      hint: "a shipped migration never changes. Revert it and put the change in a new migration "
        + "at the end of the cube's scope (<cube>-002-<description>); nothing was written",
    }
  }
  if (unlocked.length === 0) return { kind: "unchanged" }
  return { kind: "append", lock: appendedLock(lock, current), appended: unlocked }
}
