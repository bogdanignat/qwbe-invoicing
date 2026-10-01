import { Effect } from "effect"

import { DomainConflict, PersistenceFailure } from "../../cube/invoicing/index.ts"

/**
 * The typed failure mapping, in one place for every PostgreSQL adapter.
 *
 * SQLite answered with one family (`SQLITE_CONSTRAINT*`, extended code
 * `& 0xff === 19`) and the host turned it into a 409. PostgreSQL splits the same
 * ground over two SQLSTATE classes, so both are mapped:
 *
 * - class 23 in full — `23505` unique, `23514` check (the code every trigger
 *   raises), `23502` not-null, `23503` foreign key, `23P01` exclusion;
 * - the three class-22 type violations SQLite reported as
 *   `SQLITE_CONSTRAINT_DATATYPE` on a STRICT table — `22P02` invalid text
 *   representation, `22003` numeric out of range, `22001` string too long.
 *
 * `22007`/`22008` are deliberately absent: dates stay TEXT, so no column casts
 * a date and those codes cannot come from a parity path. A code outside the
 * list is a real persistence failure and must stay a 500.
 *
 * Nothing from the driver's error travels into the mapped failure — no message,
 * no `cause`, no connection string. A `pg` connection error carries the
 * configuration, password included, so forwarding the cause would put a secret
 * in the API answer and in the log.
 */

export type WriteFailure = DomainConflict | PersistenceFailure

export const persistence = (operation: string): PersistenceFailure => new PersistenceFailure({ operation })

/** Both classes, as a single set: membership is the whole decision. */
export const conflictSqlStates: ReadonlySet<string> = new Set([
  "23505", "23514", "23502", "23503", "23P01",
  "22P02", "22003", "22001",
])

export const sqlState = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const { code } = error as { readonly code: unknown }
  return typeof code === "string" ? code : undefined
}

export const isConflict = (error: unknown): boolean => {
  const state = sqlState(error)
  return state !== undefined && conflictSqlStates.has(state)
}

/**
 * The two operations that keep their own conflict code: a second conversion of
 * the same proforma is a domain answer ("already converted"), not a generic
 * write conflict, and the HTTP layer already maps it.
 */
const conversionOperations: ReadonlySet<string> = new Set([
  "save proforma conversion", "save proforma invoice conversion",
])

export const writeFailure = (error: unknown, operation: string): WriteFailure => {
  if (error instanceof DomainConflict) return error
  if (!isConflict(error)) return persistence(operation)
  return conversionOperations.has(operation)
    ? new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" })
    : new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
}

/**
 * For the few places that do surface a driver message (pool diagnostics): drop
 * anything that can carry the password. Applied to the text, never to a cause.
 */
export const redactSecrets = (text: string): string => text
  .replace(/\b(password|PGPASSWORD)\s*[=:]\s*\S+/giu, "$1=[redacted]")
  .replace(/:\/\/([^:/@\s]+):[^@\s]*@/gu, "://$1:[redacted]@")

export const write = <Value>(
  operation: string,
  run: () => Promise<Value>,
): Effect.Effect<Value, WriteFailure> =>
  Effect.tryPromise({ try: run, catch: (error) => writeFailure(error, operation) })

export const read = <Value>(
  operation: string,
  run: () => Promise<Value>,
): Effect.Effect<Value, PersistenceFailure> =>
  Effect.tryPromise({ try: run, catch: () => persistence(operation) })
