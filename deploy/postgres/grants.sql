-- The database roles of an installation. Run by the `postgres` superuser through
-- deploy/postgres/db-init.sh (the `db-init` service) on the active database before every
-- `migrate`, and by scripts/production/restore.sh on a restore's new database before its
-- archive is loaded. Idempotent: every statement converges, nothing is dropped. The
-- database is whichever one this runs on (`current_database()`), never a fixed name.
-- No password here: db-init.sh sets them from the secrets, so the ACL test
-- (kernel/storage/postgres-roles.test.ts) runs this very file without touching them.
--
--   qwbe_owner  owns the database and, through pg_database_owner, the `public` schema:
--               `migrate` and `restore` create the schema as this role.
--   qwbe_app    the application: DML on the tables, the sequences and the functions,
--               and CREATE on the database only for the scratch schema of the drift
--               replay (kernel/storage/postgres-schema-replay.ts), which it rolls back.
--               No DDL in `public`, no trigger switch, no server file or program.
--               The replay needs a real schema (pg_temp does not resolve the functions
--               its triggers call), so CREATE stays. Its residue: a schema persisted
--               through it outside `public`, which makes `backup` refuse;
--               `doctor` lists such schemas in `extraSchemas`.
--
-- Neither is a superuser, creates databases or roles, or inherits another role's rights.

DO $roles$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['qwbe_owner', 'qwbe_app'] LOOP
    -- Atomic: two concurrent runs both try, and the loser keeps the winner's role.
    BEGIN
      EXECUTE format('CREATE ROLE %I', role_name);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', role_name);
  END LOOP;
  EXECUTE format('ALTER DATABASE %I OWNER TO qwbe_owner', current_database());
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO qwbe_app', current_database());
END
$roles$;

GRANT USAGE ON SCHEMA public TO qwbe_app;

-- What qwbe_owner creates from now on (migrate, restore)...
ALTER DEFAULT PRIVILEGES FOR ROLE qwbe_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qwbe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qwbe_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qwbe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qwbe_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO qwbe_app;

-- ...and what is already there.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qwbe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qwbe_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO qwbe_app;
