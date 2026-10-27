import { createHash } from "node:crypto"

import type { MigrationScope } from "./postgres-migration-plans.ts"

/**
 * The lock of the shipped migrations: for every scope, in order, the name and
 * the SHA-256 of each migration as the executor runs it.
 *
 * A self-hosted database is upgraded by applying only what its ledger lacks, so
 * a migration that already shipped must never change: an edit, a rename, a
 * removal or a move would leave existing databases on a history no new image
 * can explain. The lock is that promise written down, and the gate
 * (`probes/migrations-lock.mjs`) holds `migrationScopes` to it. New migrations go
 * at the end of their scope and are recorded with `pnpm migrations:lock`, which
 * only ever appends.
 */

export interface LockedMigration {
  readonly name: string
  readonly sha256: string
}

export interface LockedScope {
  readonly scope: string
  readonly migrations: ReadonlyArray<LockedMigration>
}

export type MigrationsLock = ReadonlyArray<LockedScope>

export const lockCommand = "pnpm migrations:lock"

/** The statements, in order and with their boundaries: exactly what reaches the executor. */
export const migrationHash = (statements: ReadonlyArray<string>): string =>
  createHash("sha256").update(JSON.stringify(statements)).digest("hex")

/** The lock `migrationScopes` would produce today. */
export const lockOf = (scopes: ReadonlyArray<MigrationScope>): MigrationsLock =>
  scopes.map(({ scope, migrations }) => ({
    scope,
    migrations: migrations.map(({ name, statements }) => ({ name, sha256: migrationHash(statements) })),
  }))

export interface LockCheck {
  /** A shipped migration or scope changed, moved or disappeared. No command repairs this. */
  readonly broken: ReadonlyArray<string>
  /** Migrations appended after the lock; `pnpm migrations:lock` records them. */
  readonly unlocked: ReadonlyArray<string>
}

const scopeProblems = (locked: LockedScope, current: LockedScope | undefined): ReadonlyArray<string> => {
  if (current === undefined) return [`scope ${locked.scope} is locked but no longer in migrationScopes`]
  return locked.migrations.flatMap((shipped, index) => {
    const key = `${locked.scope}/${shipped.name}`
    const found = current.migrations[index]
    if (found?.name === shipped.name) {
      return found.sha256 === shipped.sha256 ? [] : [`${key} was edited after it shipped`]
    }
    if (!current.migrations.some(({ name }) => name === shipped.name)) {
      return [`${key} was removed, renamed or moved to another scope`]
    }
    return [`${key} is no longer migration ${String(index + 1)} of its scope (moved, or a migration was inserted before it)`]
  })
}

const orderProblems = (lock: MigrationsLock, current: MigrationsLock): ReadonlyArray<string> => {
  const positions = lock
    .map(({ scope }) => current.findIndex((entry) => entry.scope === scope))
    .filter((position) => position >= 0)
  const ordered = positions.every((position, index) => index === 0 || position > (positions[index - 1] ?? -1))
  return ordered ? [] : ["the locked scopes are no longer in their locked order"]
}

const unlockedOf = (lock: MigrationsLock, current: MigrationsLock): ReadonlyArray<string> =>
  current.flatMap(({ scope, migrations }) => {
    const locked = lock.find((entry) => entry.scope === scope)?.migrations.length ?? 0
    return migrations.slice(locked).map(({ name }) => `${scope}/${name}`)
  })

/** `unlocked` is only reported on an intact lock: after a break the positions mean nothing. */
export const checkLock = (lock: MigrationsLock, current: MigrationsLock): LockCheck => {
  const broken = [
    ...lock.flatMap((locked) => scopeProblems(locked, current.find((entry) => entry.scope === locked.scope))),
    ...orderProblems(lock, current),
  ]
  return { broken, unlocked: broken.length > 0 ? [] : unlockedOf(lock, current) }
}
