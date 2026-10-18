import { readFileSync } from "node:fs"

import type { PostgresSettings } from "./storage/postgres-pool.ts"

export interface RuntimeConfig {
  readonly host: string
  readonly port: number
  readonly dataDirectory: string
  readonly nodeEnvironment: string
  readonly authTokenFile: string | undefined
  readonly organizationId: string | undefined
  /** Everything the pools need. The password is already read from its file. */
  readonly pgSettings: PostgresSettings
}

const boundedPort = (value: string | undefined, variable: string, fallback: string): number => {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${variable} must be an integer between 1 and 65535`)
  }
  return parsed
}

/**
 * The database password, read exactly like `AUTH_TOKEN_FILE` is: from a file, at
 * startup, trimmed. It is never taken from an environment variable, so it cannot
 * reach a child process through an inherited `PGPASSWORD`, a crash dump of
 * `process.env` or a `docker inspect`. An unreadable path fails with the path
 * only, never with the contents.
 *
 * Fail-closed outside development, and it has to be: a missing secret used to
 * yield the empty string, which connects successfully against a `trust` server
 * or a role with no password and then serves as the owner of the schema. The
 * empty password survives in exactly one place — a development or test
 * environment, where the throwaway rigs are `trust` on purpose — and nowhere
 * else. `development` is not inferred: `NODE_ENV` has to say so.
 */
const secretFrom = (path: string | undefined, nodeEnvironment: string): string => {
  const permitEmpty = nodeEnvironment === "development" || nodeEnvironment === "test"
  if (path === undefined) {
    if (permitEmpty) return ""
    throw new Error("PGPASSWORD_FILE is required outside development")
  }
  let secret: string
  try {
    secret = readFileSync(path, "utf8").trim()
  } catch {
    throw new Error(`PGPASSWORD_FILE is not readable: ${path}`)
  }
  if (secret.length === 0 && !permitEmpty) {
    throw new Error(`PGPASSWORD_FILE is empty: ${path}`)
  }
  return secret
}

const postgresSettings = (environment: NodeJS.ProcessEnv, nodeEnvironment: string): PostgresSettings => ({
  host: environment.PGHOST ?? "db",
  port: boundedPort(environment.PGPORT, "PGPORT", "5432"),
  database: environment.PGDATABASE ?? "qwbe_invoicing",
  user: environment.PGUSER ?? "qwbe",
  password: secretFrom(environment.PGPASSWORD_FILE, nodeEnvironment),
})

export const runtimeConfig = (environment: NodeJS.ProcessEnv = process.env): RuntimeConfig => {
  const nodeEnvironment = environment.NODE_ENV ?? "development"
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: boundedPort(environment.PORT, "PORT", "3000"),
    dataDirectory: environment.DATA_DIR ?? "/data",
    nodeEnvironment,
    authTokenFile: environment.AUTH_TOKEN_FILE,
    organizationId: environment.ORGANIZATION_ID,
    pgSettings: postgresSettings(environment, nodeEnvironment),
  }
}
