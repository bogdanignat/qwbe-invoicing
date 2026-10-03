/**
 * The foundation scope: the SQL every cube baseline depends on and no cube owns.
 *
 * `qwbe_abort` is the body of every trigger whose whole job is to refuse the
 * operation. SQLite wrote the refusal inline (`SELECT RAISE(ABORT, '…')`);
 * PostgreSQL needs a function, and 54 copies of the same one-line function
 * would be 54 places for the error code to drift. The message travels as a
 * trigger argument, so the shape stays `CREATE TRIGGER … EXECUTE FUNCTION
 * qwbe_abort('<message>')` and the condition stays in the trigger's own `WHEN`.
 *
 * `ERRCODE 23514` (check_violation) is deliberate: a refused write is a
 * constraint violation on both engines, so the host maps it the same way it
 * maps a CHECK, and the HTTP answer stays 409 instead of 500.
 *
 * Consequence, recorded here because it is a real coupling: the cube baselines
 * are no longer self-sufficient SQL. They are applied after this scope, which
 * `standalone/storage` owns.
 */

/** A migration as the contracts express it: a name and ordered SQL statements. */
export interface SchemaMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const foundationScope = "foundation"

export const foundationMigrations: ReadonlyArray<SchemaMigration> = [{
  name: "000-foundation",
  statements: [
    "CREATE FUNCTION qwbe_abort() RETURNS trigger LANGUAGE plpgsql AS $qwbe$"
    + " BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE=TG_ARGV[0]; END $qwbe$",
  ],
}]
